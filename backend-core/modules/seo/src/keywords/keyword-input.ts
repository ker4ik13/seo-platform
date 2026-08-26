import { Buffer } from "node:buffer";
import { BadRequestException } from "@nestjs/common";
import {
  semanticKeywordCleaningCases,
  semanticKeywordBulkCommandMaxItems,
  semanticKeywordBulkCreatePreviewMaxItems,
  semanticKeywordDuplicatePolicies,
  semanticKeywordIntents,
  type InternalCreateSemanticKeywordInput,
  type InternalDeleteSemanticKeywordInput,
  type InternalSemanticKeywordBulkCreateInput,
  type InternalSemanticKeywordBulkCreatePreviewInput,
  type InternalSemanticKeywordBulkInput,
  type InternalSemanticKeywordCleaningInput,
  type InternalUpdateSemanticKeywordInput,
  type SemanticKeywordCleaningRules,
  type SemanticKeywordIntent
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { semanticCapacityEntitlement } from "../internal/semantic-capacity.js";

const INTENTS = new Set<string>(semanticKeywordIntents);
const MAX_KEYWORD_BULK_CREATE_BYTES = 6 * 1_024 * 1_024;

export function internalCreateSemanticKeywordInput(
  value: unknown
): InternalCreateSemanticKeywordInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "entitlement",
    "duplicatePolicy",
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
    ...optionalNote(input.note, false),
    language: canonicalLanguage(input.language),
    priority: priority(input.priority),
    isFavorite: booleanValue(input.isFavorite, "isFavorite"),
    isTracked:
      input.isTracked === undefined
        ? true
        : booleanValue(input.isTracked, "isTracked"),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tagNames: tagNames(input.tagNames),
    duplicatePolicy: duplicatePolicy(
      input.duplicatePolicy ?? "REJECT_EXISTING"
    )
  };
}

export function internalSemanticKeywordBulkCreateInput(
  value: unknown
): InternalSemanticKeywordBulkCreateInput {
  if (
    Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") >
    MAX_KEYWORD_BULK_CREATE_BYTES
  ) {
    invalid("$");
  }
  const input = exactRecord(value, [
    ...scopeFields(),
    "entitlement",
    "duplicatePolicy",
    "items"
  ]);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 2_000) {
    invalid("items");
  }
  const trustedScope = scope(input);
  const entitlement = semanticCapacityEntitlement(input.entitlement);
  const policy = duplicatePolicy(input.duplicatePolicy);
  return {
    ...trustedScope,
    entitlement,
    duplicatePolicy: policy,
    items: input.items.map((value) => {
      const item = exactRecord(value, [
        ...editableFields(),
        "duplicatePolicy"
      ]);
      const itemPolicy = item.duplicatePolicy === undefined
        ? policy
        : duplicatePolicy(item.duplicatePolicy);
      const parsed = internalCreateSemanticKeywordInput({
        ...item,
        ...trustedScope,
        entitlement,
        duplicatePolicy: itemPolicy
      });
      const {
        workspaceId: _workspaceId,
        projectId: _projectId,
        actorId: _actorId,
        entitlement: _entitlement,
        duplicatePolicy: parsedPolicy,
        ...keyword
      } = parsed;
      return {
        ...keyword,
        ...(item.duplicatePolicy === undefined
          ? {}
          : { duplicatePolicy: parsedPolicy })
      };
    })
  };
}

export function internalSemanticKeywordBulkCreatePreviewInput(
  value: unknown
): InternalSemanticKeywordBulkCreatePreviewInput {
  const input = exactRecord(value, [...scopeFields(), "items"]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > semanticKeywordBulkCreatePreviewMaxItems
  ) {
    invalid("items");
  }
  return {
    ...scope(input),
    items: input.items.map((value) => {
      const item = exactRecord(value, ["text", "language", "groupId"]);
      const groupId = optionalGroupId(item.groupId, false).groupId;
      return {
        text: keywordText(item.text),
        language: canonicalLanguage(item.language ?? "und"),
        ...(groupId ? { groupId } : {})
      };
    })
  };
}

export function internalUpdateSemanticKeywordInput(
  value: unknown
): InternalUpdateSemanticKeywordInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "version",
    ...updateEditableFields()
  ]);
  const editableCount = updateEditableFields().filter(
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
    ...(input.isTracked === undefined
      ? {}
      : { isTracked: booleanValue(input.isTracked, "isTracked") }),
    ...(input.showAiAnswerButton === undefined
      ? {}
      : {
          showAiAnswerButton: booleanValue(
            input.showAiAnswerButton,
            "showAiAnswerButton"
          )
        }),
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

export function internalDeleteSemanticKeywordInput(
  value: unknown
): InternalDeleteSemanticKeywordInput {
  const input = exactRecord(value, [...scopeFields(), "version", "permanent"]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    ...(input.permanent === undefined
      ? {}
      : { permanent: booleanValue(input.permanent, "permanent") })
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
    "isTracked",
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
      ...(patch.isTracked === undefined
        ? {}
        : {
            isTracked: booleanValue(
              patch.isTracked,
              "patch.isTracked"
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
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > semanticKeywordBulkCommandMaxItems
  ) {
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
    "note",
    "language",
    "priority",
    "isFavorite",
    "isTracked",
    "intent",
    "groupId",
    "clusterId",
    "targetUrl",
    "tagNames"
  ];
}

function updateEditableFields(): readonly string[] {
  return [...editableFields(), "showAiAnswerButton"];
}

function optionalNote(value: unknown, nullable: false): Readonly<{ note?: string }>;
function optionalNote(value: unknown, nullable: true): Readonly<{ note?: string | null }>;
function optionalNote(
  value: unknown,
  nullable: boolean
): Readonly<{ note?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { note: null };
  if (typeof value !== "string") invalid("note");
  const note = value.normalize("NFKC").trim();
  if (note.length > 4_000) invalid("note");
  return note ? { note } : nullable ? { note: null } : {};
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

function duplicatePolicy(
  value: unknown
): InternalCreateSemanticKeywordInput["duplicatePolicy"] {
  if (
    typeof value !== "string" ||
    !semanticKeywordDuplicatePolicies.some((policy) => policy === value)
  ) {
    invalid("duplicatePolicy");
  }
  return value as InternalCreateSemanticKeywordInput["duplicatePolicy"];
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
