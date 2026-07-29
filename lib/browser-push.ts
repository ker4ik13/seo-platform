import { applicationServerKeyBytes } from "./push-notifications.ts";

const SERVICE_WORKER_URL = "/push-service-worker.js";
const SERVICE_WORKER_SCOPE = "/app/";
const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

export async function currentBrowserPushSubscription(): Promise<
  PushSubscription | null
> {
  assertBrowserPushRuntime();
  const registration =
    await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
  return registration?.pushManager.getSubscription() ?? null;
}

export async function enableBrowserPushSubscription(
  applicationServerKey: string
): Promise<PushSubscription> {
  assertBrowserPushRuntime();
  const registration = await navigator.serviceWorker.register(
    SERVICE_WORKER_URL,
    {
      scope: SERVICE_WORKER_SCOPE,
      updateViaCache: "none"
    }
  );
  await activeServiceWorker(registration);
  const current = await registration.pushManager.getSubscription();
  const decodedKey = applicationServerKeyBytes(applicationServerKey);
  const applicationServerKeyBytesCopy = Uint8Array.from(decodedKey);
  if (
    current &&
    sameApplicationServerKey(
      current.options.applicationServerKey,
      applicationServerKeyBytesCopy
    )
  ) {
    return current;
  }
  if (current && !(await current.unsubscribe())) {
    throw new Error("Браузер не смог обновить ключ подписки Web Push");
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKeyBytesCopy
  });
}

function sameApplicationServerKey(
  current: ArrayBuffer | null,
  expected: Uint8Array
): boolean {
  if (!current) return false;
  const currentBytes = new Uint8Array(current);
  return (
    currentBytes.byteLength === expected.byteLength &&
    currentBytes.every((byte, index) => byte === expected[index])
  );
}

export async function unsubscribeCurrentBrowserPush(): Promise<boolean> {
  const subscription = await currentBrowserPushSubscription();
  return subscription ? subscription.unsubscribe() : true;
}

async function activeServiceWorker(
  registration: ServiceWorkerRegistration
): Promise<ServiceWorker> {
  if (registration.active) return registration.active;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    throw new Error("Service Worker не перешёл в активное состояние");
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener("statechange", onStateChange);
      reject(new Error("Превышено время запуска Service Worker"));
    }, SERVICE_WORKER_READY_TIMEOUT_MS);
    const onStateChange = () => {
      if (worker.state === "activated") {
        window.clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        resolve(worker);
      } else if (worker.state === "redundant") {
        window.clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        reject(new Error("Service Worker был заменён до активации"));
      }
    };
    worker.addEventListener("statechange", onStateChange);
    onStateChange();
  });
}

function assertBrowserPushRuntime(): void {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !("Notification" in window) ||
    !("PushManager" in window) ||
    !("serviceWorker" in navigator)
  ) {
    throw new Error("Web Push не поддерживается в этом браузере");
  }
}
