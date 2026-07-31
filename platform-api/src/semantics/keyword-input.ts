import { Buffer } from "node:buffer";
import {
  semanticKeywordIntents,
  type CreateSemanticKeywordInput,
  type SemanticKeywordBulkInput,
  type SemanticKeywordBulkPatch,
  type SemanticKeywordIntent,
  type UpdateSemanticKeywordInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const INTENTS = new Set<string>(semanticKeywordIntents);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSemanticKeywordInput(
  value: unknown
): CreateSemanticKeywordInput {
  const input = exactRecord(value, editableFields(), "$");
  const intent = optionalIntent(input.intent, false).intent;
  const groupId = optionalGroupId(input.groupId, false).groupId;
  const clusterId = optionalClusterId(input.clusterId, false).clusterId;
  const targetUrl = optionalTargetUrl(input.targetUrl, false).targetUrl;
  return {
    text: keywordText(input.text),
    language: canonicalLanguage(input.language ?? "und"),
    priority: priority(input.priority ?? 0),
    isFavorite: booleanValue(input.isFavorite ?? false, "isFavorite"),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tagNames: tagNames(input.tagNames ?? [])
  };
}

export function updateSemanticKeywordInput(
  value: unknown
): UpdateSemanticKeywordInput {
  const input = exactRecord(value, editableFields(), "$");
  if (Object.keys(input).length === 0) {
    invalid("$", "At least one editable field is required");
  }
  return {
    ...(input.text === undefined ? {} : { text: keywordText(input.text) }),
    ...(input.language === undefined
      ? {}
      : { language: canonicalLanguage(input.language) }),
    ...(input.priority === undefined
      ? {}
      : { priority: priority(input.priority) }),
    ...(input.isFavorite === undefined
      ? {}
      : { isFavorite: booleanValue(input.isFavorite, "isFavorite") }),
    ...optionalIntent(input.intent, true),
    ...optionalGroupId(input.groupId, true),
    ...optionalClusterId(input.clusterId, true),
    ...optionalTargetUrl(input.targetUrl, true),
    ...(input.tagNames === undefined
      ? {}
      : { tagNames: tagNames(input.tagNames) })
  };
}

export function semanticKeywordBulkInput(
  value: unknown
): SemanticKeywordBulkInput {
  const input = exactRecord(value, ["items", "patch"], "$");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
    invalid("items", "Must select between 1 and 200 keywords");
  }
  const items = input.items.map((value, index) => {
    const item = exactRecord(value, ["id", "version"], `items.${index}`);
    if (typeof item.id !== "string" || !UUID_PATTERN.test(item.id)) {
      invalid(`items.${index}.id`, "Must be a UUID");
    }
    if (!Number.isSafeInteger(item.version) || Number(item.version) < 1) {
      invalid(`items.${index}.version`, "Must be a positive integer");
    }
    return { id: item.id.toLowerCase(), version: Number(item.version) };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    invalid("items", "Cannot contain duplicate keywords");
  }
  return { items, patch: semanticKeywordBulkPatch(input.patch) };
}

function semanticKeywordBulkPatch(
  value: unknown
): SemanticKeywordBulkPatch {
  const input = exactRecord(
    value,
    [
      "priority",
      "isFavorite",
      "intent",
      "groupId",
      "clusterId",
      "targetUrl",
      "tagNames"
    ],
    "patch"
  );
  if (Object.keys(input).length === 0) {
    invalid("patch", "At least one bulk change is required");
  }
  return {
    ...(input.priority === undefined
      ? {}
      : { priority: priority(input.priority) }),
    ...(input.isFavorite === undefined
      ? {}
      : { isFavorite: booleanValue(input.isFavorite, "patch.isFavorite") }),
    ...optionalIntent(input.intent, true),
    ...optionalGroupId(input.groupId, true),
    ...optionalClusterId(input.clusterId, true),
    ...optionalTargetUrl(input.targetUrl, true),
    ...(input.tagNames === undefined
      ? {}
      : { tagNames: tagNames(input.tagNames) })
  };
}

function editableFields(): readonly string[] {
  return [
    "text",
    "language",
    "priority",
    "isFavorite",
    "intent",
    "groupId",
    "clusterId",
    "targetUrl",
    "tagNames"
  ];
}

function keywordText(value: unknown): string {
  const text = normalizedString(value, "text", 1, 2_000);
  if (Buffer.byteLength(text, "utf8") > 2_000) {
    invalid("text", "Must contain at most 2000 UTF-8 bytes");
  }
  return text;
}

function canonicalLanguage(value: unknown): string {
  const language = normalizedString(value, "language", 2, 16);
  if (language === "und") return language;
  try {
    const canonical = Intl.getCanonicalLocales(language);
    if (canonical.length !== 1 || !canonical[0]) throw new Error();
    return canonical[0];
  } catch {
    invalid("language", "Must be a valid BCP 47 language tag");
  }
}

function priority(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
    invalid("priority", "Must be an integer between 0 and 100");
  }
  return Number(value);
}

function optionalIntent(
  value: unknown,
  nullable: boolean
): Readonly<{ intent?: SemanticKeywordIntent | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { intent: null };
  if (typeof value !== "string" || !INTENTS.has(value)) {
    invalid("intent", "Contains an unsupported keyword intent");
  }
  return { intent: value as SemanticKeywordIntent };
}

function optionalGroupId(
  value: unknown,
  nullable: boolean
): Readonly<{ groupId?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { groupId: null };
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid("groupId", "Must be a UUID");
  }
  return { groupId: value };
}

function optionalClusterId(
  value: unknown,
  nullable: boolean
): Readonly<{ clusterId?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { clusterId: null };
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid("clusterId", "Must be a UUID");
  }
  return { clusterId: value.toLowerCase() };
}

function optionalTargetUrl(
  value: unknown,
  nullable: boolean
): Readonly<{ targetUrl?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { targetUrl: null };
  if (typeof value !== "string" || value.length > 2_048) {
    invalid("targetUrl", "Must be an HTTP or HTTPS URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid("targetUrl", "Must be an absolute HTTP or HTTPS URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    invalid(
      "targetUrl",
      "Must be an HTTP or HTTPS URL without credentials or fragment"
    );
  }
  return { targetUrl: url.toString() };
}

function tagNames(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 50) {
    invalid("tagNames", "Must be an array with at most 50 tags");
  }
  const names = value.map((item) =>
    normalizedString(item, "tagNames", 1, 160)
  );
  const unique = new Map(
    names.map((name) => [name.toLocaleLowerCase(), name] as const)
  );
  return [...unique.values()];
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "Must be a boolean");
  return value;
}

function normalizedString(
  value: unknown,
  path: string,
  min: number,
  max: number
): string {
  if (typeof value !== "string") invalid(path, "Must be a string");
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length < min || normalized.length > max) {
    invalid(path, `Must contain between ${min} and ${max} characters`);
  }
  return normalized;
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

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_SEMANTIC_KEYWORD", message);
}
