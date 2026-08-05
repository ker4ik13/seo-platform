import { ECDH } from "node:crypto";
import { isIP } from "node:net";
import type {
  RenameWebPushDeviceInput,
  UpsertWebPushSubscriptionInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const LABEL_MAXIMUM_LENGTH = 80;
const ENDPOINT_MAXIMUM_LENGTH = 2_048;
const POSTGRES_INTEGER_MAXIMUM = 2_147_483_647;
const EXPIRATION_MAXIMUM_MS =
  10 * 366 * 24 * 60 * 60 * 1_000;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const FORBIDDEN_LABEL_CHARACTERS =
  /[\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069]/u;

export function upsertWebPushSubscriptionInput(
  value: unknown
): UpsertWebPushSubscriptionInput {
  const input = exactObject(value, [
    "label",
    "intent",
    "applicationServerKeyVersion",
    "subscription"
  ]);
  const subscription = exactObject(input.subscription, [
    "endpoint",
    "expirationTime",
    "keys"
  ]);
  const keys = exactObject(subscription.keys, ["p256dh", "auth"]);

  return {
    label: deviceLabel(input.label),
    intent: intentValue(input.intent),
    applicationServerKeyVersion: positiveInteger(
      input.applicationServerKeyVersion,
      "applicationServerKeyVersion"
    ),
    subscription: {
      endpoint: endpointValue(subscription.endpoint),
      expirationTime: expirationTimeValue(subscription.expirationTime),
      keys: {
        p256dh: p256dhValue(keys.p256dh),
        auth: authValue(keys.auth)
      }
    }
  };
}

export function renameWebPushDeviceInput(
  value: unknown
): RenameWebPushDeviceInput {
  const input = exactObject(value, ["label"]);
  return { label: deviceLabel(input.label) };
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "OBJECT_REQUIRED");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    invalid("$", "EXACT_KEYS_REQUIRED");
  }
  return input;
}

function deviceLabel(value: unknown): string {
  if (typeof value !== "string") invalid("label", "STRING_REQUIRED");
  const normalized = value.normalize("NFC").trim();
  const length = [...normalized].length;
  if (
    length < 1 ||
    length > LABEL_MAXIMUM_LENGTH ||
    FORBIDDEN_LABEL_CHARACTERS.test(normalized)
  ) {
    invalid("label", "INVALID_DEVICE_LABEL");
  }
  return normalized;
}

function intentValue(
  value: unknown
): UpsertWebPushSubscriptionInput["intent"] {
  if (value !== "ENABLE" && value !== "RECONCILE") {
    invalid("intent", "INVALID_WEB_PUSH_INTENT");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > POSTGRES_INTEGER_MAXIMUM
  ) {
    invalid(path, "POSITIVE_INTEGER_REQUIRED");
  }
  return Number(value);
}

function endpointValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > ENDPOINT_MAXIMUM_LENGTH ||
    value !== value.trim()
  ) {
    invalid("subscription.endpoint", "INVALID_PUSH_ENDPOINT");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    invalid("subscription.endpoint", "INVALID_PUSH_ENDPOINT");
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/gu, "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.port ||
    isIP(hostname) !== 0
  ) {
    invalid("subscription.endpoint", "INVALID_PUSH_ENDPOINT");
  }
  return value;
}

function expirationTimeValue(value: unknown): number | null {
  if (value === null) return null;
  const now = Date.now();
  if (
    !Number.isSafeInteger(value) ||
    Number(value) <= now ||
    Number(value) > now + EXPIRATION_MAXIMUM_MS
  ) {
    invalid(
      "subscription.expirationTime",
      "INVALID_PUSH_EXPIRATION"
    );
  }
  return Number(value);
}

function p256dhValue(value: unknown): string {
  const decoded = canonicalBase64Url(
    value,
    "subscription.keys.p256dh"
  );
  if (decoded.length !== 65 || decoded[0] !== 0x04) {
    invalid("subscription.keys.p256dh", "INVALID_P256DH_KEY");
  }
  try {
    ECDH.convertKey(
      decoded,
      "prime256v1",
      undefined,
      undefined,
      "uncompressed"
    );
  } catch {
    invalid("subscription.keys.p256dh", "INVALID_P256DH_KEY");
  }
  return value as string;
}

function authValue(value: unknown): string {
  const decoded = canonicalBase64Url(value, "subscription.keys.auth");
  if (decoded.length !== 16) {
    invalid("subscription.keys.auth", "INVALID_AUTH_SECRET");
  }
  return value as string;
}

function canonicalBase64Url(value: unknown, path: string): Buffer {
  if (
    typeof value !== "string" ||
    !BASE64URL_PATTERN.test(value)
  ) {
    invalid(path, "INVALID_BASE64URL");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    invalid(path, "NON_CANONICAL_BASE64URL");
  }
  return decoded;
}

function invalid(path: string, code: string): never {
  throw validationError(path, code, "Web Push subscription is invalid");
}
