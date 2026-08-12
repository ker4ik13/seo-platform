import { BadRequestException } from "@nestjs/common";
import {
  semanticDuplicateAnalysisModes,
  semanticDuplicateKeeperStrategies,
  semanticDuplicateScopeKinds,
  type InternalApplySemanticDuplicatesInput,
  type InternalSemanticDuplicateCommandInput,
  type SemanticDuplicateGroupDecision,
  type SemanticDuplicateRules,
  type SemanticDuplicateScope
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

export function internalSemanticDuplicateCommandInput(
  value: unknown
): InternalSemanticDuplicateCommandInput {
  return command(value, false) as InternalSemanticDuplicateCommandInput;
}

export function internalApplySemanticDuplicatesInput(
  value: unknown
): InternalApplySemanticDuplicatesInput {
  return command(value, true) as InternalApplySemanticDuplicatesInput;
}

function command(
  value: unknown,
  applying: boolean
): InternalSemanticDuplicateCommandInput | InternalApplySemanticDuplicatesInput {
  const input = exactRecord(
    value,
    applying
      ? [
          "workspaceId",
          "projectId",
          "actorId",
          "rules",
          "scope",
          "keeperStrategy",
          "previewHash",
          "decisions"
        ]
      : [
          "workspaceId",
          "projectId",
          "actorId",
          "rules",
          "scope",
          "keeperStrategy"
        ]
  );
  if (
    typeof input.keeperStrategy !== "string" ||
    !semanticDuplicateKeeperStrategies.some(
      (strategy) => strategy === input.keeperStrategy
    )
  ) {
    invalid("keeperStrategy");
  }
  const result: InternalSemanticDuplicateCommandInput = {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    rules: rules(input.rules),
    scope: scope(input.scope),
    keeperStrategy:
      input.keeperStrategy as InternalSemanticDuplicateCommandInput["keeperStrategy"]
  };
  if (!applying) return result;
  if (
    typeof input.previewHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.previewHash)
  ) {
    invalid("previewHash");
  }
  return {
    ...result,
    previewHash: input.previewHash,
    decisions: duplicateDecisions(input.decisions)
  };
}

function duplicateDecisions(
  value: unknown
): readonly SemanticDuplicateGroupDecision[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    invalid("decisions");
  }
  const groupIds = new Set<string>();
  const keywordIds = new Set<string>();
  let deletionCount = 0;
  const decisions = value.map((value, groupIndex) => {
    const input = exactRecord(value, ["groupId", "keeper", "deletions"]);
    if (
      typeof input.groupId !== "string" ||
      !/^[a-f0-9]{64}$/u.test(input.groupId) ||
      groupIds.has(input.groupId)
    ) {
      invalid(`decisions.${groupIndex}.groupId`);
    }
    groupIds.add(input.groupId);
    const keeper = duplicateDecisionItem(
      input.keeper,
      `decisions.${groupIndex}.keeper`
    );
    if (keywordIds.has(keeper.id)) {
      invalid(`decisions.${groupIndex}.keeper`);
    }
    keywordIds.add(keeper.id);
    if (
      !Array.isArray(input.deletions) ||
      input.deletions.length < 1 ||
      input.deletions.length > APPLY_DECISION_LIMIT
    ) {
      invalid(`decisions.${groupIndex}.deletions`);
    }
    const deletions = input.deletions.map((value, itemIndex) => {
      const item = duplicateDecisionItem(
        value,
        `decisions.${groupIndex}.deletions.${itemIndex}`
      );
      if (keywordIds.has(item.id)) {
        invalid(`decisions.${groupIndex}.deletions.${itemIndex}`);
      }
      keywordIds.add(item.id);
      return item;
    });
    deletionCount += deletions.length;
    return { groupId: input.groupId, keeper, deletions };
  });
  if (deletionCount > APPLY_DECISION_LIMIT) invalid("decisions");
  return decisions;
}

function duplicateDecisionItem(
  value: unknown,
  field: string
): Readonly<{ readonly id: string; readonly version: number }> {
  const input = exactRecord(value, ["id", "version"]);
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) {
    invalid(`${field}.version`);
  }
  return {
    id: uuid(input.id, `${field}.id`),
    version: Number(input.version)
  };
}

const APPLY_DECISION_LIMIT = 500;

function rules(value: unknown): SemanticDuplicateRules {
  const input = exactRecord(value, [
    "analysisMode",
    "caseSensitive",
    "ignorePunctuation",
    "ignoredWords"
  ]);
  if (
    typeof input.analysisMode !== "string" ||
    !semanticDuplicateAnalysisModes.some(
      (mode) => mode === input.analysisMode
    )
  ) {
    invalid("rules.analysisMode");
  }
  if (typeof input.caseSensitive !== "boolean") {
    invalid("rules.caseSensitive");
  }
  if (typeof input.ignorePunctuation !== "boolean") {
    invalid("rules.ignorePunctuation");
  }
  if (!Array.isArray(input.ignoredWords) || input.ignoredWords.length > 100) {
    invalid("rules.ignoredWords");
  }
  const unique = new Map<string, string>();
  for (const [index, value] of input.ignoredWords.entries()) {
    if (typeof value !== "string") invalid(`rules.ignoredWords.${index}`);
    const normalized = normalizeText(value);
    if (
      normalized.length === 0 ||
      normalized.length > 80 ||
      !/[\p{L}\p{N}]/u.test(normalized)
    ) {
      invalid(`rules.ignoredWords.${index}`);
    }
    const key = input.caseSensitive
      ? normalized
      : normalized.toLocaleLowerCase("ru-RU");
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return {
    analysisMode: input.analysisMode as SemanticDuplicateRules["analysisMode"],
    caseSensitive: input.caseSensitive,
    ignorePunctuation: input.ignorePunctuation,
    ignoredWords: [...unique.values()]
  };
}

function scope(value: unknown): SemanticDuplicateScope {
  const input = exactRecord(value, ["kind", "groupId", "items"]);
  if (
    typeof input.kind !== "string" ||
    !semanticDuplicateScopeKinds.some((kind) => kind === input.kind)
  ) {
    invalid("scope.kind");
  }
  if (input.kind === "PROJECT") {
    if (input.groupId !== undefined || input.items !== undefined) {
      invalid("scope");
    }
    return { kind: "PROJECT" };
  }
  if (input.kind === "GROUP") {
    if (input.items !== undefined) invalid("scope.items");
    return { kind: "GROUP", groupId: uuid(input.groupId, "scope.groupId") };
  }
  if (
    input.groupId !== undefined ||
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 2_000
  ) {
    invalid("scope.items");
  }
  const items = input.items.map((value, index) => {
    const item = exactRecord(value, ["id", "version"]);
    if (!Number.isSafeInteger(item.version) || Number(item.version) < 1) {
      invalid(`scope.items.${index}.version`);
    }
    return {
      id: uuid(item.id, `scope.items.${index}.id`),
      version: Number(item.version)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    invalid("scope.items");
  }
  return { kind: "SELECTION", items };
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !keys.includes(key))) invalid("$");
  return input;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid semantic duplicate field: ${field}`);
}
