"use strict";

const PUSH_PAYLOAD_VERSION = 1;
const MAX_PUSH_PAYLOAD_BYTES = 4 * 1024;
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 220;
const MAX_TAG_LENGTH = 128;
const MAX_DEEP_LINK_LENGTH = 1_024;
const DEFAULT_DEEP_LINK = "/app/notifications";
const GENERIC_NOTIFICATIONS = Object.freeze({
  ru: Object.freeze({
    title: "Новое уведомление",
    body: "Откройте приложение, чтобы посмотреть обновление."
  }),
  en: Object.freeze({
    title: "New notification",
    body: "Open the app to view the update."
  })
});
const PUSH_METADATA_DATABASE = "seo-platform-device";
const PUSH_METADATA_STORE = "metadata";
const PUSH_INSTALLATION_KEY = "web-push-installation-v1";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const notification = parsePushPayload(event.data);
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      renotify: false,
      data: {
        deepLink: notification.deepLink
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = safeAppDeepLink(event.notification.data?.deepLink);
  event.waitUntil(focusOrOpenApp(deepLink));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    Promise.all([
      markReconciliationRequired(),
      notifyVisibleClientsAboutReconciliation()
    ])
  );
});

function parsePushPayload(data) {
  if (!data) return genericNotification();

  let text;
  try {
    text = data.text();
  } catch {
    return genericNotification();
  }
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    utf8ByteLength(text) > MAX_PUSH_PAYLOAD_BYTES
  ) {
    return genericNotification();
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return genericNotification();
  }
  if (!isPlainObject(payload)) return genericNotification();

  const allowedKeys = new Set([
    "version",
    "title",
    "body",
    "tag",
    "deepLink"
  ]);
  if (
    Object.keys(payload).some((key) => !allowedKeys.has(key)) ||
    payload.version !== PUSH_PAYLOAD_VERSION ||
    !isBoundedText(payload.title, MAX_TITLE_LENGTH) ||
    !isBoundedText(payload.body, MAX_BODY_LENGTH) ||
    !isBoundedText(payload.tag, MAX_TAG_LENGTH)
  ) {
    return genericNotification();
  }

  const deepLink = safeAppDeepLink(payload.deepLink);
  if (deepLink === DEFAULT_DEEP_LINK && payload.deepLink !== DEFAULT_DEEP_LINK) {
    return genericNotification();
  }
  return {
    title: payload.title.trim(),
    body: payload.body.trim(),
    tag: payload.tag.trim(),
    deepLink
  };
}

function genericNotification() {
  const language =
    typeof self.navigator?.language === "string" &&
    self.navigator.language.toLowerCase().startsWith("ru")
      ? "ru"
      : "en";
  return {
    ...GENERIC_NOTIFICATIONS[language],
    tag: "notification-generic",
    deepLink: DEFAULT_DEEP_LINK
  };
}

function safeAppDeepLink(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DEEP_LINK_LENGTH ||
    CONTROL_CHARACTERS.test(value) ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return DEFAULT_DEEP_LINK;
  }

  try {
    const url = new URL(value, self.location.origin);
    const inPrivateApp =
      url.origin === self.location.origin &&
      (url.pathname === "/app" || url.pathname.startsWith("/app/"));
    const isPrivateApi =
      url.pathname === "/app/api" || url.pathname.startsWith("/app/api/");
    const isRefreshRoute =
      url.pathname === "/app/auth/refresh" ||
      url.pathname.startsWith("/app/auth/refresh/");
    if (!inPrivateApp || isPrivateApi || isRefreshRoute) {
      return DEFAULT_DEEP_LINK;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_DEEP_LINK;
  }
}

async function focusOrOpenApp(deepLink) {
  const targetUrl = new URL(deepLink, self.location.origin).href;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });
  const appWindows = windows.filter((client) => {
    try {
      const url = new URL(client.url);
      return (
        url.origin === self.location.origin &&
        (url.pathname === "/app" || url.pathname.startsWith("/app/"))
      );
    } catch {
      return false;
    }
  });

  const exactWindow = appWindows.find((client) => client.url === targetUrl);
  if (exactWindow) return exactWindow.focus();

  const existingWindow = appWindows[0];
  if (existingWindow) {
    try {
      const navigated = await existingWindow.navigate(targetUrl);
      if (navigated) return navigated.focus();
    } catch {
      // Opening a new same-origin window remains the safe fallback.
    }
    return existingWindow.focus();
  }
  return self.clients.openWindow(targetUrl);
}

function notifyVisibleClientsAboutReconciliation() {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((windows) => {
      for (const client of windows) {
        client.postMessage({
          type: "WEB_PUSH_RECONCILE_REQUIRED",
          version: 1
        });
      }
    });
}

function markReconciliationRequired() {
  if (!("indexedDB" in self)) return Promise.resolve();
  return openMetadataDatabase()
    .then(
      (database) =>
        new Promise((resolve) => {
          const transaction = database.transaction(
            PUSH_METADATA_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(PUSH_METADATA_STORE);
          const request = store.get(PUSH_INSTALLATION_KEY);
          request.onsuccess = () => {
            const record = request.result;
            if (isPlainObject(record) && record.schemaVersion === 1) {
              store.put(
                {
                  ...record,
                  reconcileRequired: true,
                  updatedAt: new Date().toISOString()
                },
                PUSH_INSTALLATION_KEY
              );
            }
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            resolve();
          };
          transaction.onabort = () => {
            database.close();
            resolve();
          };
        })
    )
    .catch(() => {
      // A foreground reconciliation will retry storage access.
    });
}

function openMetadataDatabase() {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(PUSH_METADATA_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PUSH_METADATA_STORE)) {
        request.result.createObjectStore(PUSH_METADATA_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Push metadata DB is blocked"));
  });
}

function isBoundedText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function utf8ByteLength(value) {
  if ("TextEncoder" in self) {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length * 3;
}
