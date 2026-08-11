import { BadRequestException } from "@nestjs/common";
import {
  semanticNegativeKeywordMatchModes,
  semanticNegativeKeywordScopeKinds,
  type InternalApplySemanticNegativeKeywordsInput,
  type InternalCreateSemanticNegativeKeywordPresetInput,
  type InternalDeleteSemanticNegativeKeywordPresetInput,
  type InternalSemanticNegativeKeywordCommandInput,
  type InternalUpdateSemanticNegativeKeywordPresetInput,
  type SemanticNegativeKeywordRules,
  type SemanticNegativeKeywordScope
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

export function internalCreateNegativeKeywordPresetInput(
  value: unknown
): InternalCreateSemanticNegativeKeywordPresetInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "name",
    "rules"
  ]);
  return { ...scope(input), name: presetName(input.name), rules: rules(input.rules) };
}

export function internalUpdateNegativeKeywordPresetInput(
  value: unknown
): InternalUpdateSemanticNegativeKeywordPresetInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version",
    "name",
    "rules"
  ]);
  if (input.name === undefined && input.rules === undefined) invalid("$");
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    ...(input.name === undefined ? {} : { name: presetName(input.name) }),
    ...(input.rules === undefined ? {} : { rules: rules(input.rules) })
  };
}

export function internalDeleteNegativeKeywordPresetInput(
  value: unknown
): InternalDeleteSemanticNegativeKeywordPresetInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return { ...scope(input), version: positiveInteger(input.version, "version") };
}

export function internalNegativeKeywordCommandInput(
  value: unknown
): InternalSemanticNegativeKeywordCommandInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "presetId",
    "rules",
    "scope"
  ]);
  const command = commandFields(input);
  return { ...scope(input), ...command };
}

export function internalApplyNegativeKeywordsInput(
  value: unknown
): InternalApplySemanticNegativeKeywordsInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "presetId",
    "rules",
    "scope",
    "previewHash"
  ]);
  const command = commandFields(input);
  if (
    typeof input.previewHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.previewHash)
  ) invalid("previewHash");
  return { ...scope(input), ...command, previewHash: input.previewHash };
}

function commandFields(input: Readonly<Record<string, unknown>>) {
  const presetId = input.presetId === undefined
    ? undefined
    : uuidValue(input.presetId, "presetId");
  const inlineRules = input.rules === undefined ? undefined : rules(input.rules);
  if ((presetId === undefined) === (inlineRules === undefined)) {
    invalid("presetId/rules");
  }
  return {
    ...(presetId ? { presetId } : {}),
    ...(inlineRules ? { rules: inlineRules } : {}),
    scope: commandScope(input.scope)
  };
}

function rules(value: unknown): SemanticNegativeKeywordRules {
  const input = exactRecord(value, [
    "words",
    "matchMode",
    "caseSensitive",
    "ignoreWordOrder",
    "ignorePunctuation"
  ]);
  if (!Array.isArray(input.words) || input.words.length < 1 || input.words.length > 500) {
    invalid("rules.words");
  }
  const caseSensitive = booleanValue(input.caseSensitive, "rules.caseSensitive");
  const ignoreWordOrder = optionalBooleanValue(
    input.ignoreWordOrder,
    "rules.ignoreWordOrder"
  );
  const ignorePunctuation = optionalBooleanValue(
    input.ignorePunctuation,
    "rules.ignorePunctuation"
  );
  const words = input.words.map((word, index) => {
    const normalized = normalizedWord(word, index);
    if (ignorePunctuation && !/[\p{L}\p{N}]/u.test(normalized)) {
      invalid(`rules.words.${index}`);
    }
    return normalized;
  });
  const comparison = caseSensitive
    ? (word: string) => word
    : (word: string) => word.toLocaleLowerCase("ru-RU");
  if (new Set(words.map(comparison)).size !== words.length) invalid("rules.words");
  if (
    typeof input.matchMode !== "string" ||
    !semanticNegativeKeywordMatchModes.some((value) => value === input.matchMode)
  ) invalid("rules.matchMode");
  return {
    words,
    matchMode: input.matchMode as SemanticNegativeKeywordRules["matchMode"],
    caseSensitive,
    ignoreWordOrder,
    ignorePunctuation
  };
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function optionalBooleanValue(value: unknown, field: string): boolean {
  return value === undefined ? false : booleanValue(value, field);
}

function commandScope(value: unknown): SemanticNegativeKeywordScope {
  const input = exactRecord(value, ["kind", "groupId", "items"]);
  if (
    typeof input.kind !== "string" ||
    !semanticNegativeKeywordScopeKinds.some((kind) => kind === input.kind)
  ) invalid("scope.kind");
  if (input.kind === "PROJECT") {
    if (input.groupId !== undefined || input.items !== undefined) invalid("scope");
    return { kind: "PROJECT" };
  }
  if (input.kind === "GROUP") {
    if (input.items !== undefined) invalid("scope.items");
    return { kind: "GROUP", groupId: uuidValue(input.groupId, "scope.groupId") };
  }
  if (input.groupId !== undefined || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 2_000) {
    invalid("scope.items");
  }
  const items = input.items.map((value, index) => {
    const item = exactRecord(value, ["id", "version"]);
    return {
      id: uuidValue(item.id, `scope.items.${index}.id`),
      version: positiveInteger(item.version, `scope.items.${index}.version`)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("scope.items");
  return { kind: "SELECTION", items };
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: uuidValue(input.workspaceId, "workspaceId"),
    projectId: uuidValue(input.projectId, "projectId"),
    actorId: uuidValue(input.actorId, "actorId")
  };
}

function presetName(value: unknown): string {
  if (typeof value !== "string") invalid("name");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 160) invalid("name");
  return name;
}

function normalizedWord(value: unknown, index: number): string {
  if (typeof value !== "string") invalid(`rules.words.${index}`);
  const word = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!word || word.length > 160) invalid(`rules.words.${index}`);
  return word;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function uuidValue(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("$");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) invalid("$");
  return input;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid negative keyword field: ${field}`);
}
