import {
  semanticNegativeKeywordMatchModes,
  semanticNegativeKeywordScopeKinds,
  type ApplySemanticNegativeKeywordsInput,
  type CreateSemanticNegativeKeywordPresetInput,
  type SemanticNegativeKeywordCommandInput,
  type SemanticNegativeKeywordRules,
  type SemanticNegativeKeywordScope,
  type UpdateSemanticNegativeKeywordPresetInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

export function createNegativeKeywordPresetInput(
  value: unknown
): CreateSemanticNegativeKeywordPresetInput {
  const input = exactRecord(value, ["name", "rules"]);
  return { name: presetName(input.name), rules: rules(input.rules) };
}

export function updateNegativeKeywordPresetInput(
  value: unknown
): UpdateSemanticNegativeKeywordPresetInput {
  const input = exactRecord(value, ["name", "rules"]);
  if (input.name === undefined && input.rules === undefined) invalid("$", "At least one field is required");
  return {
    ...(input.name === undefined ? {} : { name: presetName(input.name) }),
    ...(input.rules === undefined ? {} : { rules: rules(input.rules) })
  };
}

export function negativeKeywordCommandInput(
  value: unknown
): SemanticNegativeKeywordCommandInput {
  return command(value, false) as SemanticNegativeKeywordCommandInput;
}

export function applyNegativeKeywordsInput(
  value: unknown
): ApplySemanticNegativeKeywordsInput {
  return command(value, true) as ApplySemanticNegativeKeywordsInput;
}

function command(
  value: unknown,
  applying: boolean
): SemanticNegativeKeywordCommandInput | ApplySemanticNegativeKeywordsInput {
  const input = exactRecord(
    value,
    applying ? ["presetId", "rules", "scope", "previewHash"] : ["presetId", "rules", "scope"]
  );
  const presetId = input.presetId === undefined ? undefined : uuidValue(input.presetId, "presetId");
  const inlineRules = input.rules === undefined ? undefined : rules(input.rules);
  if ((presetId === undefined) === (inlineRules === undefined)) {
    invalid("presetId", "Provide either presetId or inline rules");
  }
  const base = {
    ...(presetId ? { presetId } : {}),
    ...(inlineRules ? { rules: inlineRules } : {}),
    scope: commandScope(input.scope)
  };
  if (!applying) return base;
  if (typeof input.previewHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.previewHash)) {
    invalid("previewHash", "Preview hash is invalid");
  }
  return { ...base, previewHash: input.previewHash };
}

function rules(value: unknown): SemanticNegativeKeywordRules {
  const input = exactRecord(value, ["words", "matchMode", "caseSensitive"]);
  if (!Array.isArray(input.words) || input.words.length < 1 || input.words.length > 500) {
    invalid("rules.words", "Use between 1 and 500 words");
  }
  const words = input.words.map((word, index) => {
    if (typeof word !== "string") invalid(`rules.words.${index}`, "Must be a string");
    const normalized = word.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!normalized || normalized.length > 160) invalid(`rules.words.${index}`, "Must contain 1 to 160 characters");
    return normalized;
  });
  if (
    typeof input.matchMode !== "string" ||
    !semanticNegativeKeywordMatchModes.some((mode) => mode === input.matchMode)
  ) invalid("rules.matchMode", "Unsupported match mode");
  if (typeof input.caseSensitive !== "boolean") invalid("rules.caseSensitive", "Must be a boolean");
  const canonical = input.caseSensitive
    ? words
    : words.map((word) => word.toLocaleLowerCase("ru-RU"));
  if (new Set(canonical).size !== canonical.length) invalid("rules.words", "Duplicate words are not allowed");
  return {
    words,
    matchMode: input.matchMode as SemanticNegativeKeywordRules["matchMode"],
    caseSensitive: input.caseSensitive
  };
}

function commandScope(value: unknown): SemanticNegativeKeywordScope {
  const input = exactRecord(value, ["kind", "groupId", "items"]);
  if (
    typeof input.kind !== "string" ||
    !semanticNegativeKeywordScopeKinds.some((kind) => kind === input.kind)
  ) invalid("scope.kind", "Unsupported scope");
  if (input.kind === "PROJECT") {
    if (input.groupId !== undefined || input.items !== undefined) invalid("scope", "Project scope cannot include group or items");
    return { kind: "PROJECT" };
  }
  if (input.kind === "GROUP") {
    if (input.items !== undefined) invalid("scope.items", "Group scope cannot include items");
    return { kind: "GROUP", groupId: uuidValue(input.groupId, "scope.groupId") };
  }
  if (input.groupId !== undefined || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 2_000) {
    invalid("scope.items", "Select between 1 and 2000 keywords");
  }
  const items = input.items.map((value, index) => {
    const item = exactRecord(value, ["id", "version"]);
    if (!Number.isSafeInteger(item.version) || Number(item.version) < 1) {
      invalid(`scope.items.${index}.version`, "Must be a positive integer");
    }
    return {
      id: uuidValue(item.id, `scope.items.${index}.id`),
      version: Number(item.version)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("scope.items", "Duplicate keywords are not allowed");
  return { kind: "SELECTION", items };
}

function presetName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "Must be a string");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 160) invalid("name", "Must contain 1 to 160 characters");
  return name;
}

function uuidValue(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "Must be a UUID");
  return assertUuid(value, field);
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("$", "Must be an object");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !keys.includes(key))) invalid("$", "Contains unsupported fields");
  return input;
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_NEGATIVE_KEYWORDS", message);
}
