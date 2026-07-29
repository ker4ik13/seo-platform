import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

type WorkerListener = (event: Record<string, unknown>) => void;

test("registers no fetch/cache handler and shows a strict v1 payload", async () => {
  const worker = await loadWorker();
  assert.equal(worker.listeners.has("fetch"), false);

  let pending: Promise<unknown> | undefined;
  worker.listeners.get("push")?.({
    data: {
      text: () =>
        JSON.stringify({
          version: 1,
          title: "Позиции обновлены",
          body: "Проверка проекта завершена.",
          tag: "rank-job-1",
          deepLink: "/app/notifications?source=push"
        })
    },
    waitUntil(value: Promise<unknown>) {
      pending = value;
    }
  });
  await pending;

  assert.deepEqual(JSON.parse(JSON.stringify(worker.notifications)), [
    {
      title: "Позиции обновлены",
      options: {
        body: "Проверка проекта завершена.",
        tag: "rank-job-1",
        renotify: false,
        data: { deepLink: "/app/notifications?source=push" }
      }
    }
  ]);
});

test("falls back to a generic preview for unknown or unsafe payload fields", async () => {
  const worker = await loadWorker();
  let pending: Promise<unknown> | undefined;
  worker.listeners.get("push")?.({
    data: {
      text: () =>
        JSON.stringify({
          version: 1,
          title: "Secret",
          body: "Must not be rendered",
          tag: "unsafe",
          deepLink: "https://attacker.example/app",
          providerPayload: { token: "secret" }
        })
    },
    waitUntil(value: Promise<unknown>) {
      pending = value;
    }
  });
  await pending;

  assert.equal(worker.notifications[0]?.title, "Новое уведомление");
  assert.deepEqual(
    JSON.parse(JSON.stringify(worker.notifications[0]?.options.data)),
    { deepLink: "/app/notifications" }
  );
});

test("rejects bidi controls in notification previews", async () => {
  const worker = await loadWorker();
  let pending: Promise<unknown> | undefined;
  worker.listeners.get("push")?.({
    data: {
      text: () =>
        JSON.stringify({
          version: 1,
          title: "Отчёт \u202Ecod.exe",
          body: "Проверка проекта завершена.",
          tag: "rank-job-1",
          deepLink: "/app/notifications"
        })
    },
    waitUntil(value: Promise<unknown>) {
      pending = value;
    }
  });
  await pending;

  assert.equal(worker.notifications[0]?.title, "Новое уведомление");
});

test("never parses an oversized push payload", async () => {
  const worker = await loadWorker();
  let pending: Promise<unknown> | undefined;
  worker.listeners.get("push")?.({
    data: { text: () => "x".repeat(4 * 1_024 + 1) },
    waitUntil(value: Promise<unknown>) {
      pending = value;
    }
  });
  await pending;

  assert.equal(worker.notifications[0]?.title, "Новое уведомление");
});

test("localizes the generic fallback from the browser language", async () => {
  const worker = await loadWorker("en-US");
  let pending: Promise<unknown> | undefined;
  worker.listeners.get("push")?.({
    waitUntil(value: Promise<unknown>) {
      pending = value;
    }
  });
  await pending;

  assert.equal(worker.notifications[0]?.title, "New notification");
});

test("notification click opens only a same-origin private app path", async () => {
  const worker = await loadWorker();
  let pending: Promise<unknown> | undefined;
  let closed = false;
  worker.listeners.get("notificationclick")?.({
    notification: {
      data: { deepLink: "//attacker.example/app" },
      close() {
        closed = true;
      }
    },
    waitUntil(value: Promise<unknown>) {
      pending = value;
    }
  });
  await pending;

  assert.equal(closed, true);
  assert.deepEqual(worker.openedWindows, [
    "https://product.example/app/notifications"
  ]);
});

test("increments the durable generation and notifies clients with v2", async () => {
  const initialRecord = {
    schemaVersion: 2,
    installationId: "ba8f5c70-b5ab-4ac0-ae49-649f60df7fc4",
    ownerUserId: "01900000-0000-7000-8000-000000000001",
    reconcileGeneration: 1,
    reconciledGeneration: 0,
    updatedAt: "2026-07-29T12:00:00.000Z"
  };
  const worker = await loadWorker("ru-RU", initialRecord);

  for (const expectedGeneration of [2, 3]) {
    let pending: Promise<unknown> | undefined;
    worker.listeners.get("pushsubscriptionchange")?.({
      waitUntil(value: Promise<unknown>) {
        pending = value;
      }
    });
    await pending;

    assert.equal(
      worker.metadata?.record &&
        (worker.metadata.record as {
          reconcileGeneration: number;
        }).reconcileGeneration,
      expectedGeneration
    );
  }

  assert.deepEqual(worker.metadata?.openVersions, [undefined, undefined]);
  assert.deepEqual(worker.reconciliationMessages, [
    {
      type: "WEB_PUSH_RECONCILE_REQUIRED",
      version: 2,
      generation: 2
    },
    {
      type: "WEB_PUSH_RECONCILE_REQUIRED",
      version: 2,
      generation: 3
    }
  ]);
  assert.equal(
    (worker.metadata?.record as { reconciledGeneration: number })
      .reconciledGeneration,
    0
  );
});

interface FakeIndexedDbState {
  record: unknown;
  readonly openVersions: Array<number | undefined>;
}

async function loadWorker(
  language = "ru-RU",
  installationRecord?: unknown
): Promise<{
  readonly listeners: Map<string, WorkerListener>;
  readonly notifications: Array<{
    readonly title: string;
    readonly options: Readonly<Record<string, unknown>>;
  }>;
  readonly openedWindows: string[];
  readonly reconciliationMessages: unknown[];
  readonly metadata?: FakeIndexedDbState;
}> {
  const source = await readFile(
    new URL("../public/push-service-worker.js", import.meta.url),
    "utf8"
  );
  const listeners = new Map<string, WorkerListener>();
  const notifications: Array<{
    title: string;
    options: Readonly<Record<string, unknown>>;
  }> = [];
  const openedWindows: string[] = [];
  const reconciliationMessages: unknown[] = [];
  const metadata =
    installationRecord === undefined
      ? undefined
      : {
          record: structuredClone(installationRecord),
          openVersions: []
        };
  const workerSelf = {
    TextEncoder,
    location: { origin: "https://product.example" },
    navigator: { language },
    addEventListener(type: string, listener: WorkerListener) {
      listeners.set(type, listener);
    },
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (
        title: string,
        options: Readonly<Record<string, unknown>>
      ) => {
        notifications.push({ title, options });
      }
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () =>
        metadata
          ? [
              {
                postMessage(message: unknown) {
                  reconciliationMessages.push(
                    structuredClone(message)
                  );
                }
              }
            ]
          : [],
      openWindow: async (url: string) => {
        openedWindows.push(url);
        return undefined;
      }
    }
  };
  if (metadata) {
    Object.assign(workerSelf, {
      indexedDB: fakeIndexedDb(metadata)
    });
  }
  const context = vm.createContext({
    self: workerSelf,
    TextEncoder,
    URL,
    console
  });
  vm.runInContext(source, context);
  if (metadata) {
    metadata.record = vm.runInContext(
      `JSON.parse(${JSON.stringify(JSON.stringify(installationRecord))})`,
      context
    );
  }
  return {
    listeners,
    notifications,
    openedWindows,
    reconciliationMessages,
    ...(metadata ? { metadata } : {})
  };
}

function fakeIndexedDb(state: FakeIndexedDbState) {
  return {
    open(_name: string, version?: number) {
      state.openVersions.push(version);
      const request: {
        result?: ReturnType<typeof fakeDatabase>;
        error?: Error;
        onblocked?: () => void;
        onerror?: () => void;
        onsuccess?: () => void;
        onupgradeneeded?: () => void;
      } = {};
      queueMicrotask(() => {
        request.result = fakeDatabase(state);
        request.onsuccess?.();
      });
      return request;
    }
  };
}

function fakeDatabase(state: FakeIndexedDbState) {
  return {
    objectStoreNames: {
      contains: () => true
    },
    onversionchange: undefined as (() => void) | undefined,
    close() {},
    createObjectStore() {},
    transaction() {
      let pendingRecord: unknown;
      const transaction: {
        error?: Error;
        onabort?: () => void;
        oncomplete?: () => void;
        onerror?: () => void;
        objectStore: () => {
          get: () => {
            result?: unknown;
            onsuccess?: () => void;
          };
          put: (value: unknown) => void;
        };
      } = {
        objectStore: () => ({
          get: () => {
            const request: {
              result?: unknown;
              onsuccess?: () => void;
            } = {};
            queueMicrotask(() => {
              request.result = state.record;
              request.onsuccess?.();
              queueMicrotask(() => {
                if (pendingRecord !== undefined) {
                  state.record = pendingRecord;
                }
                transaction.oncomplete?.();
              });
            });
            return request;
          },
          put: (value: unknown) => {
            pendingRecord = value;
          }
        })
      };
      return transaction;
    }
  };
}
