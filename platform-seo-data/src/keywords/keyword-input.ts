import { Buffer } from "node:buffer";
import { BadRequestException } from "@nestjs/common";
import {
  semanticKeywordIntents,
  type InternalCreateSemanticKeywordInput,
  type InternalDeleteSemanticKeywordInput,
  type InternalSemanticKeywordBulkInput,
  type InternalUpdateSemanticKeywordInput,
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
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
    invalid("items");
  }
  const items = input.items.map((value) => {
    const item = exactRecord(value, ["id", "version"]);
    return {
      id: uuid(item.id, "items.id"),
      version: positiveInteger(item.version, "items.version")
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    invalid("items");
  }
  const patch = exactRecord(input.patch, [
    "priority",
    "isFavorite",
    "intent",
    "groupId",
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
      ...optionalTargetUrl(patch.targetUrl, true),
      ...(patch.tagNames === undefined
        ? {}
        : { tagNames: tagNames(patch.tagNames) })
    }
  };
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
