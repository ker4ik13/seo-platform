import { ECDH } from "node:crypto";
import { isIP } from "node:net";
import { BadRequestException } from "@nestjs/common";
import {
  webPushBrowsers,
  webPushPlatforms,
  webPushRegistrationIntents,
  type InternalRenameWebPushDeviceInput,
  type InternalUpsertWebPushSubscriptionInput,
  type WebPushBrowser,
  type WebPushPlatform
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { internalUuid } from "../internal/internal-context.js";

const LABEL_CONTROL_PATTERN =
  /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function webPushUpsertInput(
  value: unknown,
  config: AppConfig
): InternalUpsertWebPushSubscriptionInput {
  const input = exactObject(value, [
    "userId",
    "sessionFamilyId",
    "browser",
    "platform",
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
  const endpoint = endpointValue(subscription.endpoint, config);
  return {
    userId: internalUuid(stringValue(input.userId, "userId"), "userId"),
    sessionFamilyId: internalUuid(
      stringValue(input.sessionFamilyId, "sessionFamilyId"),
      "sessionFamilyId"
    ),
    browser: enumValue(input.browser, webPushBrowsers, "browser"),
    platform: enumValue(input.platform, webPushPlatforms, "platform"),
    label: labelValue(input.label),
    intent: enumValue(
      input.intent,
      webPushRegistrationIntents,
      "intent"
    ),
    applicationServerKeyVersion: positiveInteger(
      input.applicationServerKeyVersion,
      "applicationServerKeyVersion"
    ),
    subscription: {
      endpoint,
      expirationTime: expirationTimeValue(
        subscription.expirationTime
      ),
      keys: {
        p256dh: p256dhValue(keys.p256dh),
        auth: authValue(keys.auth)
      }
    }
  };
}

export function webPushRenameInput(
  value: unknown
): InternalRenameWebPushDeviceInput {
  const input = exactObject(value, ["userId", "version", "label"]);
  return {
    userId: internalUuid(stringValue(input.userId, "userId"), "userId"),
    version: positiveInteger(input.version, "version"),
    label: labelValue(input.label)
  };
}

export function normalizedWebPushBrowser(value: unknown): WebPushBrowser {
  return enumValue(value, webPushBrowsers, "browser");
}

export function normalizedWebPushPlatform(value: unknown): WebPushPlatform {
  return enumValue(value, webPushPlatforms, "platform");
}

function endpointValue(value: unknown, config: AppConfig): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim()
  ) {
    invalid("subscription.endpoint", "Use a bounded HTTPS push endpoint");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    invalid("subscription.endpoint", "Use a valid HTTPS push endpoint");
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/gu, "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.port ||
    isIP(hostname) !== 0 ||
    endpoint.href !== value ||
    !config.webPush.endpointOrigins.includes(endpoint.origin)
  ) {
    invalid(
      "subscription.endpoint",
      "Push endpoint origin is not allowed"
    );
  }
  return value;
}

function p256dhValue(value: unknown): string {
  const encoded = canonicalBase64Url(value, "subscription.keys.p256dh");
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length !== 65 || decoded[0] !== 4) {
    invalid(
      "subscription.keys.p256dh",
      "Use an uncompressed P-256 public key"
    );
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
    invalid(
      "subscription.keys.p256dh",
      "Use a valid P-256 public key"
    );
  }
  return encoded;
}

function authValue(value: unknown): string {
  const encoded = canonicalBase64Url(value, "subscription.keys.auth");
  if (Buffer.from(encoded, "base64url").length !== 16) {
    invalid(
      "subscription.keys.auth",
      "Use a 16-byte authentication secret"
    );
  }
  return encoded;
}

function canonicalBase64Url(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    invalid(field, "Use canonical unpadded base64url");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    invalid(field, "Use canonical unpadded base64url");
  }
  return value;
}

function expirationTimeValue(value: unknown): number | null {
  if (value === null) return null;
  const maximum = Date.now() + 10 * 366 * 24 * 60 * 60 * 1_000;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) <= Date.now() ||
    Number(value) > maximum
  ) {
    invalid(
      "subscription.expirationTime",
      "Use null or a future epoch timestamp"
    );
  }
  return value as number;
}

function labelValue(value: unknown): string {
  const label = stringValue(value, "label").normalize("NFC");
  if (
    [...label].length > 80 ||
    LABEL_CONTROL_PATTERN.test(label)
  ) {
    invalid("label", "Use 1 to 80 visible characters");
  }
  return label;
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "A JSON object is required");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(input);
  if (
    actual.length !== allowedKeys.length ||
    actual.some((key) => !allowedKeys.includes(key)) ||
    allowedKeys.some((key) => !(key in input))
  ) {
    invalid("$", `Expected exactly: ${allowedKeys.join(", ")}`);
  }
  return input;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(field, "A non-empty string is required");
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2_147_483_647
  ) {
    invalid(field, "A positive PostgreSQL integer is required");
  }
  return value as number;
}

function enumValue<Value extends string>(
  value: unknown,
  values: readonly Value[],
  field: string
): Value {
  if (
    typeof value !== "string" ||
    !values.some((candidate) => candidate === value)
  ) {
    invalid(field, `Must be one of: ${values.join(", ")}`);
  }
  return value as Value;
}

function invalid(field: string, message: string): never {
  throw new BadRequestException(`${field}: ${message}`);
}
