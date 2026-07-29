import { types as nodeTypes } from "node:util";

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
