import { timingSafeEqual } from "node:crypto";
import type {
  InternalRankExecutionParameters,
  TrackingContextConfigurationInput,
  TrackingDomainMatchRule
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { Prisma } from "../generated/prisma/client.js";

const EXECUTION_HASH_SCHEMA = "rank-estimate-execution@1";
const PROVIDER_MAPPING_VERSION = "arsenkin-positions@1";

export function rankEstimateExecutionParameters(
  configuration: TrackingContextConfigurationInput
): InternalRankExecutionParameters | undefined {
  if (
    configuration.searchEngine !== "GOOGLE" ||
    configuration.depth !== 30
  ) {
    return undefined;
  }
  return {
    searchEngine: "GOOGLE",
    countryCode: configuration.countryCode,
    ...(configuration.regionCode
      ? { regionCode: configuration.regionCode }
      : {}),
    language: configuration.language,
    device: configuration.device,
    depth: 30,
    domainMatchRule: copyDomainMatchRule(
      configuration.domainMatchRule
    ),
    safeSearch: configuration.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: PROVIDER_MAPPING_VERSION
  };
}

export function rankEstimateExecutionHash(
  execution: InternalRankExecutionParameters
): Buffer {
  return Buffer.from(
    canonicalJsonSha256(EXECUTION_HASH_SCHEMA, execution),
    "hex"
  );
}

export function rankEstimateExecutionJson(
  execution: InternalRankExecutionParameters
): Prisma.InputJsonValue {
  return execution as unknown as Prisma.InputJsonValue;
}

export function storedRankEstimateExecution(
  value: unknown,
  storedHash: Uint8Array | null
): InternalRankExecutionParameters | undefined {
  if (value === null || storedHash === null) {
    if (value !== null || storedHash !== null) {
      invalid();
    }
    return undefined;
  }
  const execution = parseRankExecutionParameters(value);
  const actualHash = rankEstimateExecutionHash(execution);
  const expectedHash = Buffer.from(storedHash);
  if (
    expectedHash.length !== actualHash.length ||
    !timingSafeEqual(expectedHash, actualHash)
  ) {
    invalid();
  }
  return execution;
}

export function parseRankExecutionParameters(
  value: unknown
): InternalRankExecutionParameters {
  const input = exactRecord(value, [
    "searchEngine",
    "countryCode",
    ...(hasField(value, "regionCode") ? ["regionCode"] : []),
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    "format",
    "rawSerp",
    "fallbackMode",
    "providerMappingVersion"
  ]);
  if (
    input.searchEngine !== "GOOGLE" ||
    typeof input.countryCode !== "string" ||
    !/^[A-Z]{2}$/u.test(input.countryCode) ||
    ("regionCode" in input &&
      (typeof input.regionCode !== "string" ||
        input.regionCode.length < 1 ||
        input.regionCode.length > 100 ||
        input.regionCode !== input.regionCode.trim())) ||
    !canonicalLanguage(input.language) ||
    !["DESKTOP", "MOBILE"].includes(String(input.device)) ||
    input.depth !== 30 ||
    typeof input.safeSearch !== "boolean" ||
    input.format !== "SIMPLE" ||
    input.rawSerp !== false ||
    input.fallbackMode !== "NONE" ||
    input.providerMappingVersion !== PROVIDER_MAPPING_VERSION
  ) {
    invalid();
  }
  return {
    searchEngine: "GOOGLE",
    countryCode: input.countryCode,
    ...("regionCode" in input
      ? { regionCode: input.regionCode as string }
      : {}),
    language: input.language,
    device: input.device as InternalRankExecutionParameters["device"],
    depth: 30,
    domainMatchRule: domainMatchRule(input.domainMatchRule),
    safeSearch: input.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: PROVIDER_MAPPING_VERSION
  };
}

function copyDomainMatchRule(
  value: TrackingDomainMatchRule
): TrackingDomainMatchRule {
  return "value" in value
    ? { mode: value.mode, value: value.value }
    : { mode: value.mode };
}

function domainMatchRule(value: unknown): TrackingDomainMatchRule {
  const input = record(value);
  if (
    input.mode === "SPECIFIC_URL" ||
    input.mode === "URL_PREFIX"
  ) {
    exactFields(input, ["mode", "value"]);
    if (
      typeof input.value !== "string" ||
      input.value.length < 1 ||
      input.value.length > 2_048 ||
      input.value !== input.value.trim()
    ) {
      invalid();
    }
    return { mode: input.mode, value: input.value };
  }
  exactFields(input, ["mode"]);
  if (
    ![
      "EXACT_HOST",
      "INCLUDE_WWW",
      "INCLUDE_SUBDOMAINS",
      "CANONICAL_DOMAIN",
      "ANY_PROJECT_MIRROR"
    ].includes(String(input.mode))
  ) {
    invalid();
  }
  return {
    mode: input.mode as Exclude<
      TrackingDomainMatchRule["mode"],
      "SPECIFIC_URL" | "URL_PREFIX"
    >
  };
}

function canonicalLanguage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function hasField(value: unknown, field: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    field in value
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  exactFields(input, fields);
  return input;
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): void {
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid();
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(): never {
  throw new Error("Invalid immutable rank estimate execution snapshot");
}
