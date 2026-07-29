import {
  trackingDepths,
  trackingDevices,
  trackingDomainMatchModes,
  trackingSearchEngines,
  type CreateTrackingContextInput,
  type TrackingContextConfigurationInput,
  type TrackingContextKeywordQuery,
  type TrackingDomainMatchRule,
  type UpdateTrackingContextInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const SEARCH_ENGINES = new Set<string>(trackingSearchEngines);
const DEVICES = new Set<string>(trackingDevices);
const DEPTHS = new Set<number>(trackingDepths);
const DOMAIN_MATCH_MODES = new Set<string>(
  trackingDomainMatchModes
);
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1000}$/u;

export function createTrackingContextInput(
  value: unknown
): CreateTrackingContextInput {
  return contextInput(value);
}

export function updateTrackingContextInput(
  value: unknown
): UpdateTrackingContextInput {
  return contextInput(value);
}

export function trackingContextKeywordQuery(
  value: unknown
): TrackingContextKeywordQuery {
  const query = queryRecord(value);
  const limit = optionalSingleString(query.limit, "limit");
  const cursor = optionalSingleString(query.cursor, "cursor");
  const search = optionalSingleString(query.search, "search")?.normalize(
    "NFKC"
  );
  const parsedLimit = limit === undefined ? 100 : Number(limit);

  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 200
  ) {
    invalid("limit", "Must be an integer between 1 and 200");
  }
  if (cursor && !CURSOR_PATTERN.test(cursor)) {
    invalid("cursor", "Must be a valid pagination cursor");
  }
  if (search && search.length > 200) {
    invalid("search", "Must contain at most 200 characters");
  }

  return {
    limit: parsedLimit,
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {})
  };
}

function contextInput(
  value: unknown
): CreateTrackingContextInput {
  const input = exactRecord(value, ["name", "configuration"], "$");
  return {
    name: normalizedString(input.name, "name", 1, 160),
    configuration: configurationInput(input.configuration)
  };
}

function configurationInput(
  value: unknown
): TrackingContextConfigurationInput {
  const input = exactRecord(
    value,
    [
      "searchEngine",
      "countryCode",
      "regionCode",
      "regionLabel",
      "language",
      "device",
      "depth",
      "domainMatchRule",
      "safeSearch"
    ],
    "configuration"
  );
  const searchEngine = enumValue(
    input.searchEngine,
    SEARCH_ENGINES,
    "configuration.searchEngine"
  ) as TrackingContextConfigurationInput["searchEngine"];
  const countryCode = normalizedString(
    input.countryCode,
    "configuration.countryCode",
    2,
    2
  ).toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(countryCode)) {
    invalid(
      "configuration.countryCode",
      "Must be an ISO 3166-1 alpha-2 country code"
    );
  }
  const regionCode = optionalNormalizedString(
    input.regionCode,
    "configuration.regionCode",
    1,
    100
  );
  const regionLabel = optionalNormalizedString(
    input.regionLabel,
    "configuration.regionLabel",
    1,
    160
  );
  if (regionLabel && !regionCode) {
    invalid(
      "configuration.regionLabel",
      "Requires configuration.regionCode"
    );
  }
  const language = canonicalLanguage(input.language);
  const device = enumValue(
    input.device,
    DEVICES,
    "configuration.device"
  ) as TrackingContextConfigurationInput["device"];
  if (
    typeof input.depth !== "number" ||
    !DEPTHS.has(input.depth)
  ) {
    invalid("configuration.depth", "Must be one of 30, 50 or 100");
  }
  if (typeof input.safeSearch !== "boolean") {
    invalid("configuration.safeSearch", "Must be a boolean");
  }

  return {
    searchEngine,
    countryCode,
    ...(regionCode ? { regionCode } : {}),
    ...(regionLabel ? { regionLabel } : {}),
    language,
    device,
    depth: input.depth as TrackingContextConfigurationInput["depth"],
    domainMatchRule: domainMatchRule(input.domainMatchRule),
    safeSearch: input.safeSearch
  };
}

function domainMatchRule(value: unknown): TrackingDomainMatchRule {
  const input = exactRecord(
    value,
    ["mode", "value"],
    "configuration.domainMatchRule"
  );
  const mode = enumValue(
    input.mode,
    DOMAIN_MATCH_MODES,
    "configuration.domainMatchRule.mode"
  ) as TrackingDomainMatchRule["mode"];
  if (mode !== "SPECIFIC_URL" && mode !== "URL_PREFIX") {
    if (input.value !== undefined) {
      invalid(
        "configuration.domainMatchRule.value",
        "Must be omitted for this matching mode"
      );
    }
    return { mode };
  }

  const urlValue = normalizedString(
    input.value,
    "configuration.domainMatchRule.value",
    8,
    2048
  );
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    invalid(
      "configuration.domainMatchRule.value",
      "Must be an absolute HTTP or HTTPS URL"
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    invalid(
      "configuration.domainMatchRule.value",
      "Must be an absolute HTTP or HTTPS URL without credentials or fragment"
    );
  }
  return { mode, value: urlValue };
}

function canonicalLanguage(value: unknown): string {
  const language = normalizedString(
    value,
    "configuration.language",
    2,
    16
  );
  try {
    const canonical = Intl.getCanonicalLocales(language);
    if (canonical.length !== 1 || !canonical[0]) throw new Error();
    return canonical[0];
  } catch {
    invalid(
      "configuration.language",
      "Must be a valid BCP 47 language tag"
    );
  }
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  path: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "Must be a JSON object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    invalid(path, "Contains unsupported fields");
  }
  return input;
}

function queryRecord(
  value: unknown
): Readonly<Record<string, unknown>> {
  if (value === undefined) return {};
  return exactRecord(value, ["limit", "cursor", "search"], "$query");
}

function normalizedString(
  value: unknown,
  path: string,
  min: number,
  max: number
): string {
  if (typeof value !== "string") {
    invalid(path, "Must be a string");
  }
  const normalized = value.normalize("NFKC").trim();
  const canonical = normalized.replace(/\s+/gu, " ");
  if (canonical.length < min || canonical.length > max) {
    invalid(path, `Must contain between ${min} and ${max} characters`);
  }
  return canonical;
}

function optionalNormalizedString(
  value: unknown,
  path: string,
  min: number,
  max: number
): string | undefined {
  return value === undefined
    ? undefined
    : normalizedString(value, path, min, max);
}

function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    invalid(path, "Contains an unsupported value");
  }
  return value;
}

function optionalSingleString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    invalid(field, "Must be a single non-empty string");
  }
  return value.trim();
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_TRACKING_CONTEXT", message);
}
