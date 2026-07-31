import type {
  RenameWebPushDeviceInput,
  UpsertWebPushSubscriptionInput,
  WebPushBrowser,
  WebPushDeviceStatus,
  WebPushDeviceStatusReason,
  WebPushDeviceSummary,
  WebPushDeliveryStatus,
  WebPushPlatform,
  WebPushRegistration,
  WebPushRegistrationIntent,
  WebPushRevokeResult,
  WebPushSubscriptionInput,
  WebPushSubscriptionsState
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CONTROL_OR_BIDI_CHARACTERS =
  /[\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069]/u;
const MAX_DEVICE_LABEL_LENGTH = 80;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_DEVICE_PROJECTION = 100;

const DEVICE_STATUSES = new Set<WebPushDeviceStatus>([
  "ACTIVE",
  "REVOKED",
  "EXPIRED"
]);
const DEVICE_STATUS_REASONS = new Set<WebPushDeviceStatusReason>([
  "USER_REVOKED",
  "SESSION_REVOKED",
  "PERMISSION_REVOKED",
  "PUSH_SERVICE_GONE",
  "ACCOUNT_CHANGED"
]);
const DELIVERY_STATUSES = new Set<WebPushDeliveryStatus>([
  "NEVER",
  "DELIVERED",
  "FAILED"
]);
const BROWSERS = new Set<WebPushBrowser>([
  "CHROME",
  "EDGE",
  "FIREFOX",
  "OPERA",
  "SAFARI",
  "OTHER"
]);
const PLATFORMS = new Set<WebPushPlatform>([
  "ANDROID",
  "CHROMEOS",
  "IOS",
  "LINUX",
  "MACOS",
  "WINDOWS",
  "OTHER"
]);

export type WebPushUnsupportedReason =
  | "NOT_IN_BROWSER"
  | "INSECURE_CONTEXT"
  | "NOTIFICATION_UNSUPPORTED"
  | "SERVICE_WORKER_UNSUPPORTED"
  | "PUSH_MANAGER_UNSUPPORTED";

export type WebPushFeatureSupport =
  | {
      readonly supported: true;
      readonly permission: NotificationPermission;
    }
  | {
      readonly supported: false;
      readonly reason: WebPushUnsupportedReason;
    };

export interface WebPushRuntimeProbe {
  readonly inBrowser: boolean;
  readonly secureContext: boolean;
  readonly notificationSupported: boolean;
  readonly serviceWorkerSupported: boolean;
  readonly pushManagerSupported: boolean;
  readonly permission?: NotificationPermission;
}

export type BrowserPushViewState =
  | "LOADING"
  | "SERVER_DISABLED"
  | "UNSUPPORTED"
  | "OWNER_CONFLICT"
  | "REGISTERING"
  | "ACTIVE"
  | "OFFLINE"
  | "ERROR"
  | "PERMISSION_DEFAULT"
  | "PERMISSION_DENIED"
  | "GRANTED_UNSUBSCRIBED";

export interface BrowserPushViewStateInput {
  readonly loading: boolean;
  readonly registrationStatus?: WebPushRegistration["status"];
  readonly featureSupport: WebPushFeatureSupport;
  readonly ownerConflict: boolean;
  readonly registering: boolean;
  readonly active: boolean;
  readonly online: boolean;
  readonly hasError: boolean;
}

export interface PushSubscriptionLike {
  readonly endpoint: string;
  readonly expirationTime: number | null;
  getKey(name: "p256dh" | "auth"): ArrayBuffer | null;
}

export interface WebPushRegistrationCommand {
  readonly label: string;
  readonly intent: WebPushRegistrationIntent;
  readonly applicationServerKeyVersion: number;
  readonly subscription: PushSubscriptionLike;
}

export function detectWebPushFeatureSupport(): WebPushFeatureSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return webPushFeatureSupport({
      inBrowser: false,
      secureContext: false,
      notificationSupported: false,
      serviceWorkerSupported: false,
      pushManagerSupported: false
    });
  }
  return webPushFeatureSupport({
    inBrowser: true,
    secureContext: window.isSecureContext,
    notificationSupported: "Notification" in window,
    serviceWorkerSupported: "serviceWorker" in navigator,
    pushManagerSupported: "PushManager" in window,
    ...("Notification" in window
      ? { permission: window.Notification.permission }
      : {})
  });
}

export function webPushFeatureSupport(
  probe: WebPushRuntimeProbe
): WebPushFeatureSupport {
  if (!probe.inBrowser) {
    return { supported: false, reason: "NOT_IN_BROWSER" };
  }
  if (!probe.secureContext) {
    return { supported: false, reason: "INSECURE_CONTEXT" };
  }
  if (!probe.notificationSupported) {
    return { supported: false, reason: "NOTIFICATION_UNSUPPORTED" };
  }
  if (!probe.serviceWorkerSupported) {
    return { supported: false, reason: "SERVICE_WORKER_UNSUPPORTED" };
  }
  if (!probe.pushManagerSupported) {
    return { supported: false, reason: "PUSH_MANAGER_UNSUPPORTED" };
  }
  return { supported: true, permission: probe.permission ?? "default" };
}

export function deriveBrowserPushViewState(
  input: BrowserPushViewStateInput
): BrowserPushViewState {
  if (input.loading) return "LOADING";
  if (input.registrationStatus === "DISABLED") return "SERVER_DISABLED";
  if (!input.featureSupport.supported) return "UNSUPPORTED";
  if (input.ownerConflict) return "OWNER_CONFLICT";
  if (input.registering) return "REGISTERING";
  if (input.active) return "ACTIVE";
  if (!input.online) return "OFFLINE";
  if (input.hasError) return "ERROR";
  if (input.featureSupport.permission === "denied") {
    return "PERMISSION_DENIED";
  }
  if (input.featureSupport.permission === "default") {
    return "PERMISSION_DEFAULT";
  }
  return "GRANTED_UNSUBSCRIBED";
}

export function currentWebPushDeviceReady(
  device: WebPushDeviceSummary | undefined,
  registration: WebPushRegistration | undefined,
  localSubscription: boolean,
  permission: NotificationPermission | undefined
): boolean {
  return Boolean(
    device?.status === "ACTIVE" &&
      registration?.status === "AVAILABLE" &&
      localSubscription &&
      permission === "granted" &&
      device.applicationServerKeyVersion ===
        registration.applicationServerKeyVersion
  );
}

export function webPushDeviceNeedsReconciliation(
  device: WebPushDeviceSummary | undefined,
  registration: WebPushRegistration | undefined,
  localMarker: boolean
): boolean {
  return Boolean(
    device?.status === "ACTIVE" &&
      (localMarker ||
        (registration?.status === "AVAILABLE" &&
          device.applicationServerKeyVersion !==
            registration.applicationServerKeyVersion))
  );
}

export function parseWebPushSubscriptionsState(
  value: unknown
): WebPushSubscriptionsState {
  const state = exactObject(value, ["registration", "devices"]);
  const registration = parseRegistration(state.registration);
  if (
    !Array.isArray(state.devices) ||
    state.devices.length > MAX_DEVICE_PROJECTION
  ) {
    invalidPushResponse();
  }
  const devices = state.devices.map(parseDevice);
  if (
    new Set(devices.map(({ installationId }) => installationId)).size !==
    devices.length
  ) {
    invalidPushResponse();
  }
  return { registration, devices };
}

export function parseWebPushDeviceSummary(
  value: unknown
): WebPushDeviceSummary {
  return parseDevice(value);
}

export function parseWebPushDeviceMutation(
  value: unknown,
  expectedInstallationId: string
): WebPushDeviceSummary {
  const device = parseDevice(value);
  assertExpectedInstallation(
    device.installationId,
    expectedInstallationId
  );
  if (device.status !== "ACTIVE") invalidPushResponse();
  return device;
}

export function parseWebPushRevokeResult(
  value: unknown
): WebPushRevokeResult {
  const result = exactObject(value, [
    "installationId",
    "status",
    "revoked"
  ]);
  if (
    !isUuid(result.installationId) ||
    result.status !== "REVOKED" ||
    typeof result.revoked !== "boolean"
  ) {
    invalidPushResponse();
  }
  return {
    installationId: result.installationId,
    status: "REVOKED",
    revoked: result.revoked
  };
}

export function parseWebPushRevokeMutation(
  value: unknown,
  expectedInstallationId: string
): WebPushRevokeResult {
  const result = parseWebPushRevokeResult(value);
  assertExpectedInstallation(
    result.installationId,
    expectedInstallationId
  );
  return result;
}

export function serializeWebPushRegistration(
  command: WebPushRegistrationCommand
): UpsertWebPushSubscriptionInput {
  const label = normalizeDeviceLabel(command.label);
  if (command.intent !== "ENABLE" && command.intent !== "RECONCILE") {
    throw new Error("Некорректное назначение регистрации Web Push");
  }
  if (
    !Number.isSafeInteger(command.applicationServerKeyVersion) ||
    command.applicationServerKeyVersion < 1
  ) {
    throw new Error("Некорректная версия ключа Web Push");
  }

  return {
    label,
    intent: command.intent,
    applicationServerKeyVersion: command.applicationServerKeyVersion,
    subscription: serializePushSubscription(command.subscription)
  };
}

export function webPushSubscriptionMatchesInput(
  subscription: PushSubscriptionLike,
  expected: WebPushSubscriptionInput
): boolean {
  try {
    const current = serializePushSubscription(subscription);
    return (
      current.endpoint === expected.endpoint &&
      current.expirationTime === expected.expirationTime &&
      current.keys.p256dh === expected.keys.p256dh &&
      current.keys.auth === expected.keys.auth
    );
  } catch {
    return false;
  }
}

function serializePushSubscription(
  subscription: PushSubscriptionLike
): WebPushSubscriptionInput {
  const endpoint = safePushEndpoint(subscription.endpoint);
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) {
    throw new Error("Браузер не вернул ключи подписки Web Push");
  }
  const p256dhBytes = new Uint8Array(p256dh);
  const authBytes = new Uint8Array(auth);
  if (p256dhBytes.byteLength !== 65 || p256dhBytes[0] !== 0x04) {
    throw new Error("Браузер вернул некорректный ключ подписки Web Push");
  }
  if (authBytes.byteLength !== 16) {
    throw new Error("Браузер вернул некорректный секрет Web Push");
  }

  const expirationTime = subscription.expirationTime;
  if (
    expirationTime !== null &&
    (!Number.isSafeInteger(expirationTime) || expirationTime <= Date.now())
  ) {
    throw new Error("Подписка Web Push уже истекла");
  }

  return {
    endpoint,
    expirationTime,
    keys: {
      p256dh: bytesToBase64Url(p256dhBytes),
      auth: bytesToBase64Url(authBytes)
    }
  };
}

export function serializeWebPushRename(
  label: string
): RenameWebPushDeviceInput {
  return { label: normalizeDeviceLabel(label) };
}

export function applicationServerKeyBytes(value: string): Uint8Array {
  const decoded = base64UrlBytes(value);
  if (decoded.byteLength !== 65 || decoded[0] !== 0x04) {
    throw new Error("Сервер вернул некорректный публичный ключ Web Push");
  }
  return decoded;
}

export function normalizeDeviceLabel(value: string): string {
  const normalized = value.normalize("NFC").trim();
  if (
    [...normalized].length < 1 ||
    [...normalized].length > MAX_DEVICE_LABEL_LENGTH ||
    CONTROL_OR_BIDI_CHARACTERS.test(normalized)
  ) {
    throw new Error("Название устройства должно содержать от 1 до 80 символов");
  }
  return normalized;
}

function parseRegistration(value: unknown): WebPushRegistration {
  const registration = plainObject(value);
  if (registration.status === "AVAILABLE") {
    assertExactKeys(registration, [
      "status",
      "applicationServerKey",
      "applicationServerKeyVersion",
      "maxActiveDevices",
      "deliveryAvailable",
      "testDeliveryAvailable"
    ]);
    applicationServerKeyBytes(stringValue(registration.applicationServerKey));
    if (
      !isPositiveInteger(registration.applicationServerKeyVersion) ||
      !isPositiveInteger(registration.maxActiveDevices) ||
      registration.maxActiveDevices > MAX_DEVICE_PROJECTION ||
      typeof registration.deliveryAvailable !== "boolean" ||
      registration.testDeliveryAvailable !== false
    ) {
      invalidPushResponse();
    }
    return {
      status: "AVAILABLE",
      applicationServerKey: registration.applicationServerKey as string,
      applicationServerKeyVersion:
        registration.applicationServerKeyVersion as number,
      maxActiveDevices: registration.maxActiveDevices as number,
      deliveryAvailable: registration.deliveryAvailable as boolean,
      testDeliveryAvailable: false
    };
  }
  assertExactKeys(registration, [
    "status",
    "reason",
    "maxActiveDevices",
    "deliveryAvailable",
    "testDeliveryAvailable"
  ]);
  if (
    registration.status !== "DISABLED" ||
    registration.reason !== "SERVER_NOT_CONFIGURED" ||
    !isPositiveInteger(registration.maxActiveDevices) ||
    registration.maxActiveDevices > MAX_DEVICE_PROJECTION ||
    registration.deliveryAvailable !== false ||
    registration.testDeliveryAvailable !== false
  ) {
    invalidPushResponse();
  }
  return {
    status: "DISABLED",
    reason: "SERVER_NOT_CONFIGURED",
    maxActiveDevices: registration.maxActiveDevices as number,
    deliveryAvailable: false,
    testDeliveryAvailable: false
  };
}

function parseDevice(value: unknown): WebPushDeviceSummary {
  const device = plainObject(value);
  assertExactKeys(
    device,
    [
      "installationId",
      "label",
      "status",
      "statusReason",
      "browser",
      "platform",
      "applicationServerKeyVersion",
      "expirationAt",
      "lastDeliveryStatus",
      "lastDeliveryAt",
      "createdAt",
      "updatedAt",
      "revokedAt",
      "expiredAt",
      "version"
    ],
    [
      "installationId",
      "label",
      "status",
      "browser",
      "platform",
      "applicationServerKeyVersion",
      "lastDeliveryStatus",
      "createdAt",
      "updatedAt",
      "version"
    ]
  );
  if (
    !isUuid(device.installationId) ||
    typeof device.label !== "string" ||
    !isNormalizedDeviceLabel(device.label) ||
    !DEVICE_STATUSES.has(device.status as WebPushDeviceStatus) ||
    !BROWSERS.has(device.browser as WebPushBrowser) ||
    !PLATFORMS.has(device.platform as WebPushPlatform) ||
    !DELIVERY_STATUSES.has(
      device.lastDeliveryStatus as WebPushDeliveryStatus
    ) ||
    !isPositiveInteger(device.applicationServerKeyVersion) ||
    !isPositiveInteger(device.version)
  ) {
    invalidPushResponse();
  }
  if (
    device.statusReason !== undefined &&
    !DEVICE_STATUS_REASONS.has(
      device.statusReason as WebPushDeviceStatusReason
    )
  ) {
    invalidPushResponse();
  }
  for (const key of [
    "expirationAt",
    "lastDeliveryAt",
    "createdAt",
    "updatedAt",
    "revokedAt",
    "expiredAt"
  ] as const) {
    if (
      (key === "createdAt" || key === "updatedAt") &&
      device[key] === undefined
    ) {
      invalidPushResponse();
    }
    if (device[key] !== undefined && !isIsoTimestamp(device[key])) {
      invalidPushResponse();
    }
  }
  const statusIsConsistent =
    (device.status === "ACTIVE" &&
      device.statusReason === undefined &&
      device.revokedAt === undefined &&
      device.expiredAt === undefined) ||
    (device.status === "REVOKED" &&
      device.statusReason !== undefined &&
      device.revokedAt !== undefined &&
      device.expiredAt === undefined) ||
    (device.status === "EXPIRED" &&
      device.statusReason !== undefined &&
      device.revokedAt === undefined &&
      device.expiredAt !== undefined);
  const deliveryIsConsistent =
    (device.lastDeliveryStatus === "NEVER" &&
      device.lastDeliveryAt === undefined) ||
    ((device.lastDeliveryStatus === "DELIVERED" ||
      device.lastDeliveryStatus === "FAILED") &&
      device.lastDeliveryAt !== undefined);
  if (!statusIsConsistent || !deliveryIsConsistent) {
    invalidPushResponse();
  }
  return device as unknown as WebPushDeviceSummary;
}

function isNormalizedDeviceLabel(value: string): boolean {
  try {
    return normalizeDeviceLabel(value) === value;
  } catch {
    return false;
  }
}

function exactObject(
  value: unknown,
  requiredKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  const object = plainObject(value);
  assertExactKeys(object, requiredKeys);
  return object;
}

function plainObject(value: unknown): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalidPushResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
  object: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys
): void {
  const keys = Object.keys(object);
  if (
    keys.some((key) => !allowedKeys.includes(key)) ||
    requiredKeys.some((key) => !keys.includes(key))
  ) {
    invalidPushResponse();
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value) &&
    value === value.toLowerCase()
  );
}

function assertExpectedInstallation(
  actualInstallationId: string,
  expectedInstallationId: string
): void {
  if (
    !isUuid(expectedInstallationId) ||
    actualInstallationId !== expectedInstallationId
  ) {
    invalidPushResponse();
  }
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") invalidPushResponse();
  return value;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function safePushEndpoint(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ENDPOINT_LENGTH ||
    value !== value.trim()
  ) {
    throw new Error("Браузер вернул некорректный endpoint Web Push");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Браузер вернул некорректный endpoint Web Push");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.port ||
    isIpAddress(endpoint.hostname)
  ) {
    throw new Error("Браузер вернул небезопасный endpoint Web Push");
  }
  return value;
}

function isIpAddress(hostname: string): boolean {
  const unwrapped = hostname.replace(/^\[|\]$/gu, "");
  if (unwrapped.includes(":")) return true;
  const parts = unwrapped.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      const number = Number(part);
      return /^\d{1,3}$/u.test(part) && number >= 0 && number <= 255;
    })
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function base64UrlBytes(value: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    invalidPushResponse();
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = globalThis.atob(
      value.replace(/-/gu, "+").replace(/_/gu, "/") + padding
    );
  } catch {
    invalidPushResponse();
  }
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0)
  );
  if (bytesToBase64Url(bytes) !== value) invalidPushResponse();
  return bytes;
}

function invalidPushResponse(): never {
  throw new Error("Сервер вернул некорректное состояние Web Push");
}
