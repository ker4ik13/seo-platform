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

async function loadWorker(language = "ru-RU"): Promise<{
  readonly listeners: Map<string, WorkerListener>;
  readonly notifications: Array<{
    readonly title: string;
    readonly options: Readonly<Record<string, unknown>>;
  }>;
  readonly openedWindows: string[];
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
      matchAll: async () => [],
      openWindow: async (url: string) => {
        openedWindows.push(url);
        return undefined;
      }
    }
  };
  vm.runInNewContext(source, {
    self: workerSelf,
    TextEncoder,
    URL,
    console
  });
  return { listeners, notifications, openedWindows };
}
