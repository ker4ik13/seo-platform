import { ECDH } from "node:crypto";
import {
  webPushBrowsers,
  webPushDeliveryStatuses,
  webPushDeviceStatuses,
  webPushDeviceStatusReasons,
  webPushPlatforms,
  type WebPushDeviceSummary,
  type WebPushRegistration,
  type WebPushRevokeResult,
  type WebPushSubscriptionsState
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const FORBIDDEN_LABEL_CHARACTERS =
  /[\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069]/u;
const MAXIMUM_DEVICE_COUNT = 100;

export function webPushSubscriptionsState(
  value: unknown
): WebPushSubscriptionsState {
  const state = exactObject(value, ["registration", "devices"]);
  if (
    !Array.isArray(state.devices) ||
    state.devices.length > MAXIMUM_DEVICE_COUNT
  ) {
    throw invalidResponse();
  }
  const devices = state.devices.map(webPushDeviceSummary);
  if (
    new Set(devices.map((device) => device.installationId)).size !==
    devices.length
  ) {
    throw invalidResponse();
  }
  return {
    registration: registrationValue(state.registration),
    devices
  };
}

export function webPushDeviceSummary(
  value: unknown
): WebPushDeviceSummary {
  const device = exactObject(value, [
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
  ], true);
  if (
    !uuid(device.installationId) ||
    !safeLabel(device.label) ||
    !enumValue(device.status, webPushDeviceStatuses) ||
    (device.statusReason !== undefined &&
      !enumValue(device.statusReason, webPushDeviceStatusReasons)) ||
    !enumValue(device.browser, webPushBrowsers) ||
    !enumValue(device.platform, webPushPlatforms) ||
    !positiveInteger(device.applicationServerKeyVersion) ||
    !enumValue(device.lastDeliveryStatus, webPushDeliveryStatuses) ||
    !optionalDate(device.expirationAt) ||
    !optionalDate(device.lastDeliveryAt) ||
    !dateString(device.createdAt) ||
    !dateString(device.updatedAt) ||
    !optionalDate(device.revokedAt) ||
    !optionalDate(device.expiredAt) ||
    !positiveInteger(device.version) ||
    !validDeviceLifecycle(device)
  ) {
    throw invalidResponse();
  }
  return {
    installationId: device.installationId,
    label: device.label,
    status: device.status,
    ...(device.statusReason === undefined
      ? {}
      : { statusReason: device.statusReason }),
    browser: device.browser,
    platform: device.platform,
    applicationServerKeyVersion: device.applicationServerKeyVersion,
    ...(device.expirationAt === undefined
      ? {}
      : { expirationAt: device.expirationAt }),
    lastDeliveryStatus: device.lastDeliveryStatus,
    ...(device.lastDeliveryAt === undefined
      ? {}
      : { lastDeliveryAt: device.lastDeliveryAt }),
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    ...(device.revokedAt === undefined
      ? {}
      : { revokedAt: device.revokedAt }),
    ...(device.expiredAt === undefined
      ? {}
      : { expiredAt: device.expiredAt }),
    version: device.version
  } as WebPushDeviceSummary;
}

export function webPushRevokeResult(
  value: unknown
): WebPushRevokeResult {
  const result = exactObject(value, [
    "installationId",
    "status",
    "revoked"
  ]);
  if (
    !uuid(result.installationId) ||
    result.status !== "REVOKED" ||
    typeof result.revoked !== "boolean"
  ) {
    throw invalidResponse();
  }
  return {
    installationId: result.installationId,
    status: "REVOKED",
    revoked: result.revoked
  };
}

function registrationValue(value: unknown): WebPushRegistration {
  const candidate = objectValue(value);
  if (candidate?.status === "AVAILABLE") {
    const registration = exactObject(value, [
      "status",
      "applicationServerKey",
      "applicationServerKeyVersion",
      "maxActiveDevices",
      "deliveryAvailable",
      "testDeliveryAvailable"
    ]);
    if (
      !validP256PublicKey(registration.applicationServerKey) ||
      !positiveInteger(registration.applicationServerKeyVersion) ||
      !positiveInteger(registration.maxActiveDevices) ||
      registration.deliveryAvailable !== false ||
      registration.testDeliveryAvailable !== false
    ) {
      throw invalidResponse();
    }
    return {
      status: "AVAILABLE",
      applicationServerKey: registration.applicationServerKey,
      applicationServerKeyVersion:
        registration.applicationServerKeyVersion,
      maxActiveDevices: registration.maxActiveDevices,
      deliveryAvailable: false,
      testDeliveryAvailable: false
    };
  }
  const registration = exactObject(value, [
    "status",
    "reason",
    "maxActiveDevices",
    "deliveryAvailable",
    "testDeliveryAvailable"
  ]);
  if (
    registration.status !== "DISABLED" ||
    registration.reason !== "SERVER_NOT_CONFIGURED" ||
    !positiveInteger(registration.maxActiveDevices) ||
    registration.deliveryAvailable !== false ||
    registration.testDeliveryAvailable !== false
  ) {
    throw invalidResponse();
  }
  return {
    status: "DISABLED",
    reason: "SERVER_NOT_CONFIGURED",
    maxActiveDevices: registration.maxActiveDevices,
    deliveryAvailable: false,
    testDeliveryAvailable: false
  };
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
  optionalKeys = false
): Readonly<Record<string, unknown>> {
  const object = objectValue(value);
  if (!object) throw invalidResponse();
  const keys = Object.keys(object);
  if (
    keys.some((key) => !allowedKeys.includes(key)) ||
    (!optionalKeys && keys.length !== allowedKeys.length)
  ) {
    throw invalidResponse();
  }
  return object;
}

function objectValue(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function safeLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.normalize("NFC").trim() &&
    [...value].length >= 1 &&
    [...value].length <= 80 &&
    !FORBIDDEN_LABEL_CHARACTERS.test(value)
  );
}

function enumValue<Value extends string>(
  value: unknown,
  values: readonly Value[]
): value is Value {
  return (
    typeof value === "string" &&
    values.some((candidate) => candidate === value)
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function optionalDate(value: unknown): value is string | undefined {
  return value === undefined || dateString(value);
}

function validDeviceLifecycle(
  device: Readonly<Record<string, unknown>>
): boolean {
  const validDelivery =
    device.lastDeliveryStatus === "NEVER"
      ? device.lastDeliveryAt === undefined
      : device.lastDeliveryAt !== undefined;
  if (!validDelivery) return false;

  if (device.status === "ACTIVE") {
    return (
      device.statusReason === undefined &&
      device.revokedAt === undefined &&
      device.expiredAt === undefined
    );
  }
  if (device.status === "REVOKED") {
    return (
      (device.statusReason === "USER_REVOKED" ||
        device.statusReason === "SESSION_REVOKED" ||
        device.statusReason === "PERMISSION_REVOKED" ||
        device.statusReason === "ACCOUNT_CHANGED") &&
      device.expirationAt === undefined &&
      device.revokedAt !== undefined &&
      device.expiredAt === undefined
    );
  }
  if (device.status === "EXPIRED") {
    return (
      device.statusReason === "PUSH_SERVICE_GONE" &&
      device.expirationAt === undefined &&
      device.revokedAt === undefined &&
      device.expiredAt !== undefined
    );
  }
  return false;
}

function dateString(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const date = new Date(value);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString() === value
  );
}

function validP256PublicKey(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !BASE64URL_PATTERN.test(value)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== 65 ||
    decoded[0] !== 0x04 ||
    decoded.toString("base64url") !== value
  ) {
    return false;
  }
  try {
    ECDH.convertKey(
      decoded,
      "prime256v1",
      undefined,
      undefined,
      "uncompressed"
    );
    return true;
  } catch {
    return false;
  }
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Realtime service returned an invalid Web Push response",
    retryable: true
  });
}
