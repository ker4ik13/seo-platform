import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

const HASH_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,127}$/u;

/**
 * Dependency-free, server-only RFC 8785 JSON Canonicalization Scheme
 * serializer.
 *
 * Contract hashes must use parsed I-JSON values. Unsupported JavaScript
 * values are rejected instead of being silently dropped or coerced.
 */
export function canonicalizeJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

/**
 * Shared versioned hash recipe for cross-service contracts.
 *
 * SHA-256 input is the UTF-8 sequence
 * `seo-platform.${domain}\0${RFC8785(value)}`. Domain must include the
 * contract version, for example `rank-manifest@1`.
 */
export function canonicalJsonSha256(
  domain: string,
  value: unknown
): string {
  if (!HASH_DOMAIN_PATTERN.test(domain)) {
    throw new TypeError("Invalid canonical JSON hash domain");
  }
  return createHash("sha256")
    .update(`seo-platform.${domain}\u0000`, "utf8")
    .update(canonicalizeJson(value), "utf8")
    .digest("hex");
}

/**
 * Exact SHA-256 over the raw UTF-8 bytes of a string.
 *
 * No Unicode normalization, JSON serialization, delimiter or trailing
 * newline is added. This is intentionally separate from canonical JSON
 * hashing and is used only where the containing contract names that recipe.
 */
export function utf8Sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalidCanonicalJson();
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    return invalidCanonicalJson();
  }
  if (nodeTypes.isProxy(value)) {
    return invalidCanonicalJson();
  }

  if (ancestors.has(value)) {
    return invalidCanonicalJson();
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return serializeArray(value, ancestors);
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidCanonicalJson();
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      return invalidCanonicalJson();
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.getOwnPropertyNames(value).sort();
    const properties: string[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        return invalidCanonicalJson();
      }
      assertValidUnicode(key);
      properties.push(
        `${JSON.stringify(key)}:${serialize(descriptor.value, ancestors)}`
      );
    }
    return `{${properties.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function serializeArray(
  value: readonly unknown[],
  ancestors: Set<object>
): string {
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return invalidCanonicalJson();
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return invalidCanonicalJson();
  }
  const length = lengthDescriptor.value as number;
  if (Object.getOwnPropertyNames(value).length !== length + 1) {
    return invalidCanonicalJson();
  }

  const items: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return invalidCanonicalJson();
    }
    items.push(serialize(descriptor.value, ancestors));
  }
  return `[${items.join(",")}]`;
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (
        !Number.isInteger(next) ||
        next < 0xdc00 ||
        next > 0xdfff
      ) {
        return invalidCanonicalJson();
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return invalidCanonicalJson();
    }
  }
}

function invalidCanonicalJson(): never {
  throw new TypeError("Value is not valid RFC 8785 I-JSON");
}
