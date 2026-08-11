import { Buffer } from "node:buffer";
import {
  semanticKeywordCleaningCases,
  semanticKeywordDuplicatePolicies,
  semanticKeywordIntents,
  type CreateSemanticKeywordInput,
  type SemanticKeywordBulkCreateInput,
  type SemanticKeywordBulkInput,
  type SemanticKeywordBulkPatch,
  type SemanticKeywordCleaningInput,
  type SemanticKeywordCleaningRules,
  type SemanticKeywordIntent,
  type UpdateSemanticKeywordInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const INTENTS = new Set<string>(semanticKeywordIntents);
const MAX_KEYWORD_BULK_CREATE_BYTES = 6 * 1_024 * 1_024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSemanticKeywordInput(
  value: unknown
): CreateSemanticKeywordInput {
  const input = exactRecord(
    value,
    [...editableFields(), "duplicatePolicy"],
    "$"
  );
  const intent = optionalIntent(input.intent, false).intent;
  const groupId = optionalGroupId(input.groupId, false).groupId;
  const clusterId = optionalClusterId(input.clusterId, false).clusterId;
  const targetUrl = optionalTargetUrl(input.targetUrl, false).targetUrl;
  return {
    text: keywordText(input.text),
    ...optionalNote(input.note, false),
    language: canonicalLanguage(input.language ?? "und"),
    priority: priority(input.priority ?? 0),
    isFavorite: booleanValue(input.isFavorite ?? false, "isFavorite"),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tagNames: tagNames(input.tagNames ?? []),
    duplicatePolicy: duplicatePolicy(
      input.duplicatePolicy ?? "REJECT_EXISTING"
    )
  };
}

export function semanticKeywordBulkCreateInput(
  value: unknown
): SemanticKeywordBulkCreateInput {
  if (
    Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") >
    MAX_KEYWORD_BULK_CREATE_BYTES
  ) {
    invalid("$", "Bulk keyword payload is too large");
  }
  const input = exactRecord(value, ["items", "duplicatePolicy"], "$");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 2_000) {
    invalid("items", "Must contain between 1 and 2000 keywords");
  }
  const policy = duplicatePolicy(input.duplicatePolicy);
  return {
    duplicatePolicy: policy,
    items: input.items.map((item) => {
      const parsed = createSemanticKeywordInput(item);
      const { duplicatePolicy: _ignored, ...keyword } = parsed;
      return keyword;
    })
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
    ...optionalNote(input.note, true),
    ...(input.tagNames === undefined
      ? {}
      : { tagNames: tagNames(input.tagNames) })
  };
}

export function deleteSemanticKeywordInput(
  value: unknown
): Readonly<{ permanent?: boolean }> {
  if (value === undefined || value === null || value === "") return {};
  const input = exactRecord(value, ["permanent"], "$");
  if (input.permanent === undefined) return {};
  if (typeof input.permanent !== "boolean") {
    invalid("permanent", "Must be a boolean");
  }
  return { permanent: input.permanent };
}

export function semanticKeywordBulkInput(
  value: unknown
): SemanticKeywordBulkInput {
  const input = exactRecord(value, ["items", "patch"], "$");
  const items = semanticKeywordSelections(input.items);
  return { items, patch: semanticKeywordBulkPatch(input.patch) };
}

export function semanticKeywordCleaningInput(
  value: unknown
): SemanticKeywordCleaningInput {
  const input = exactRecord(value, ["items", "rules"], "$");
  return {
    items: semanticKeywordSelections(input.items),
    rules: semanticKeywordCleaningRules(input.rules)
  };
}

function semanticKeywordSelections(
  value: unknown
): SemanticKeywordBulkInput["items"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    invalid("items", "Must select between 1 and 200 keywords");
  }
  const items = value.map((entry, index) => {
    const item = exactRecord(entry, ["id", "version"], `items.${index}`);
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
  return items;
}

function semanticKeywordCleaningRules(
  value: unknown
): SemanticKeywordCleaningRules {
  const input = exactRecord(
    value,
    [
      "collapseWhitespace",
      "normalizeQuotes",
      "normalizeDashes",
      "normalizeYo",
      "removeSearchOperators",
      "letterCase"
    ],
    "rules"
  );
  const rules: SemanticKeywordCleaningRules = {
    ...(input.collapseWhitespace === undefined
      ? {}
      : {
          collapseWhitespace: booleanValue(
            input.collapseWhitespace,
            "rules.collapseWhitespace"
          )
        }),
    ...(input.normalizeQuotes === undefined
      ? {}
      : {
          normalizeQuotes: booleanValue(
            input.normalizeQuotes,
            "rules.normalizeQuotes"
          )
        }),
    ...(input.normalizeDashes === undefined
      ? {}
      : {
          normalizeDashes: booleanValue(
            input.normalizeDashes,
            "rules.normalizeDashes"
          )
        }),
    ...(input.normalizeYo === undefined
      ? {}
      : {
          normalizeYo: booleanValue(input.normalizeYo, "rules.normalizeYo")
        }),
    ...(input.removeSearchOperators === undefined
      ? {}
      : {
          removeSearchOperators: booleanValue(
            input.removeSearchOperators,
            "rules.removeSearchOperators"
          )
        }),
    ...(input.letterCase === undefined
      ? {}
      : { letterCase: cleaningCase(input.letterCase) })
  };
  if (
    !Object.entries(rules).some(
      ([key, entry]) =>
        (key === "letterCase" && entry !== "KEEP") || entry === true
    )
  ) {
    invalid("rules", "At least one cleaning rule is required");
  }
  return rules;
}

function cleaningCase(
  value: unknown
): NonNullable<SemanticKeywordCleaningRules["letterCase"]> {
  if (
    typeof value !== "string" ||
    !semanticKeywordCleaningCases.some((item) => item === value)
  ) {
    invalid("rules.letterCase", "Contains an unsupported letter case");
  }
  return value as NonNullable<SemanticKeywordCleaningRules["letterCase"]>;
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
    "note",
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

function optionalNote(value: unknown, nullable: false): Readonly<{ note?: string }>;
function optionalNote(value: unknown, nullable: true): Readonly<{ note?: string | null }>;
function optionalNote(
  value: unknown,
  nullable: boolean
): Readonly<{ note?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { note: null };
  if (typeof value !== "string") {
    invalid("note", "Must be a string or null");
  }
  const note = value.normalize("NFKC").trim();
  if (note.length > 4_000) {
    invalid("note", "Must contain at most 4000 characters");
  }
  return note ? { note } : nullable ? { note: null } : {};
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

function duplicatePolicy(
  value: unknown
): SemanticKeywordBulkCreateInput["duplicatePolicy"] {
  if (
    typeof value !== "string" ||
    !semanticKeywordDuplicatePolicies.some((policy) => policy === value)
  ) {
    invalid(
      "duplicatePolicy",
      "Must be SKIP_EXISTING, REJECT_EXISTING, ADD_TO_GROUP or RESTORE_TRASHED"
    );
  }
  return value as SemanticKeywordBulkCreateInput["duplicatePolicy"];
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
