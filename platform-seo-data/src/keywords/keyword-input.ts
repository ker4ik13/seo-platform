import { Buffer } from "node:buffer";
import { BadRequestException } from "@nestjs/common";
import {
  semanticKeywordCleaningCases,
  semanticKeywordIntents,
  type InternalCreateSemanticKeywordInput,
  type InternalDeleteSemanticKeywordInput,
  type InternalSemanticKeywordBulkInput,
  type InternalSemanticKeywordCleaningInput,
  type InternalUpdateSemanticKeywordInput,
  type SemanticKeywordCleaningRules,
  type SemanticKeywordIntent
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { semanticCapacityEntitlement } from "../internal/semantic-capacity.js";

const INTENTS = new Set<string>(semanticKeywordIntents);

export function internalCreateSemanticKeywordInput(
  value: unknown
): InternalCreateSemanticKeywordInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "entitlement",
    ...editableFields()
  ]);
  const intent = optionalIntent(input.intent, false).intent;
  const groupId = optionalGroupId(input.groupId, false).groupId;
  const clusterId = optionalClusterId(input.clusterId, false).clusterId;
  const targetUrl = optionalTargetUrl(input.targetUrl, false).targetUrl;
  return {
    ...scope(input),
    entitlement: semanticCapacityEntitlement(input.entitlement),
    text: keywordText(input.text),
    language: canonicalLanguage(input.language),
    priority: priority(input.priority),
    isFavorite: booleanValue(input.isFavorite, "isFavorite"),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tagNames: tagNames(input.tagNames)
  };
}

export function internalUpdateSemanticKeywordInput(
  value: unknown
): InternalUpdateSemanticKeywordInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "version",
    ...editableFields()
  ]);
  const editableCount = editableFields().filter(
    (key) => input[key] !== undefined
  ).length;
  if (editableCount === 0) invalid("$");
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
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

export function internalDeleteSemanticKeywordInput(
  value: unknown
): InternalDeleteSemanticKeywordInput {
  const input = exactRecord(value, [...scopeFields(), "version"]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
  };
}

export function internalSemanticKeywordBulkInput(
  value: unknown
): InternalSemanticKeywordBulkInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "items",
    "patch"
  ]);
  const items = semanticKeywordSelections(input.items);
  const patch = exactRecord(input.patch, [
    "priority",
    "isFavorite",
    "intent",
    "groupId",
    "clusterId",
    "targetUrl",
    "tagNames"
  ]);
  if (Object.keys(patch).length === 0) invalid("patch");
  return {
    ...scope(input),
    items,
    patch: {
      ...(patch.priority === undefined
        ? {}
        : { priority: priority(patch.priority) }),
      ...(patch.isFavorite === undefined
        ? {}
        : {
            isFavorite: booleanValue(
              patch.isFavorite,
              "patch.isFavorite"
            )
          }),
      ...optionalIntent(patch.intent, true),
      ...optionalGroupId(patch.groupId, true),
      ...optionalClusterId(patch.clusterId, true),
      ...optionalTargetUrl(patch.targetUrl, true),
      ...(patch.tagNames === undefined
        ? {}
        : { tagNames: tagNames(patch.tagNames) })
    }
  };
}

export function internalSemanticKeywordCleaningInput(
  value: unknown
): InternalSemanticKeywordCleaningInput {
  const input = exactRecord(value, [...scopeFields(), "items", "rules"]);
  return {
    ...scope(input),
    items: semanticKeywordSelections(input.items),
    rules: semanticKeywordCleaningRules(input.rules)
  };
}

function semanticKeywordSelections(
  value: unknown
): InternalSemanticKeywordBulkInput["items"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    invalid("items");
  }
  const items = value.map((entry) => {
    const item = exactRecord(entry, ["id", "version"]);
    return {
      id: uuid(item.id, "items.id"),
      version: positiveInteger(item.version, "items.version")
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    invalid("items");
  }
  return items;
}

function semanticKeywordCleaningRules(
  value: unknown
): SemanticKeywordCleaningRules {
  const input = exactRecord(value, [
    "collapseWhitespace",
    "normalizeQuotes",
    "normalizeDashes",
    "normalizeYo",
    "removeSearchOperators",
    "letterCase"
  ]);
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
      : { normalizeYo: booleanValue(input.normalizeYo, "rules.normalizeYo") }),
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
    invalid("rules");
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
    invalid("rules.letterCase");
  }
  return value as NonNullable<SemanticKeywordCleaningRules["letterCase"]>;
}

function scopeFields(): readonly string[] {
  return ["workspaceId", "projectId", "actorId"];
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

function scope(input: Readonly<Record<string, unknown>>): {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
} {
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function keywordText(value: unknown): string {
  const text = normalizedString(value, "text", 1, 2_000);
  if (Buffer.byteLength(text, "utf8") > 2_000) invalid("text");
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
    invalid("language");
  }
}

function priority(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
    invalid("priority");
  }
  return Number(value);
}

function optionalIntent(
  value: unknown,
  nullable: boolean
): Readonly<{ intent?: SemanticKeywordIntent | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { intent: null };
  if (typeof value !== "string" || !INTENTS.has(value)) invalid("intent");
  return { intent: value as SemanticKeywordIntent };
}

function optionalGroupId(
  value: unknown,
  nullable: boolean
): Readonly<{ groupId?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { groupId: null };
  return { groupId: uuid(value, "groupId") };
}

function optionalClusterId(
  value: unknown,
  nullable: boolean
): Readonly<{ clusterId?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { clusterId: null };
  return { clusterId: uuid(value, "clusterId") };
}

function optionalTargetUrl(
  value: unknown,
  nullable: boolean
): Readonly<{ targetUrl?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { targetUrl: null };
  if (typeof value !== "string" || value.length > 2_048) invalid("targetUrl");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid("targetUrl");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    invalid("targetUrl");
  }
  return { targetUrl: url.toString() };
}

function tagNames(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 50) invalid("tagNames");
  const names = value.map((item) =>
    normalizedString(item, "tagNames", 1, 160)
  );
  return [
    ...new Map(
      names.map((name) => [name.toLocaleLowerCase(), name] as const)
    ).values()
  ];
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function normalizedString(
  value: unknown,
  field: string,
  min: number,
  max: number
): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length < min || normalized.length > max) invalid(field);
  return normalized;
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    invalid("$");
  }
  return input;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid semantic keyword field: ${field}`);
}
