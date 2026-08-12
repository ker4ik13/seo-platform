import {
  semanticDuplicateAnalysisModes,
  semanticDuplicateKeeperStrategies,
  semanticDuplicatePreviewPageSizes,
  semanticDuplicateScopeKinds,
  type ApplySemanticDuplicatesInput,
  type SemanticDuplicateCommandInput,
  type SemanticDuplicateGroupDecision,
  type SemanticDuplicatePreviewInput,
  type SemanticDuplicateRules,
  type SemanticDuplicateScope
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

export function semanticDuplicateCommandInput(
  value: unknown
): SemanticDuplicatePreviewInput {
  return command(value, false) as SemanticDuplicatePreviewInput;
}

export function applySemanticDuplicatesInput(
  value: unknown
): ApplySemanticDuplicatesInput {
  return command(value, true) as ApplySemanticDuplicatesInput;
}

function command(
  value: unknown,
  applying: boolean
): SemanticDuplicatePreviewInput | ApplySemanticDuplicatesInput {
  const input = exactRecord(
    value,
    applying
      ? [
          "rules",
          "scope",
          "keeperStrategy",
          "previewHash",
          "decisions"
        ]
      : ["rules", "scope", "keeperStrategy", "page", "pageSize"]
  );
  if (
    typeof input.keeperStrategy !== "string" ||
    !semanticDuplicateKeeperStrategies.some(
      (strategy) => strategy === input.keeperStrategy
    )
  ) {
    invalid("keeperStrategy", "Unsupported keeper strategy");
  }
  const result: SemanticDuplicateCommandInput = {
    rules: duplicateRules(input.rules),
    scope: duplicateScope(input.scope),
    keeperStrategy: input.keeperStrategy as SemanticDuplicateCommandInput["keeperStrategy"]
  };
  if (!applying) {
    return {
      ...result,
      page: previewPage(input.page),
      pageSize: previewPageSize(input.pageSize)
    };
  }
  if (
    typeof input.previewHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.previewHash)
  ) {
    invalid("previewHash", "Preview hash is invalid");
  }
  return {
    ...result,
    previewHash: input.previewHash,
    decisions: duplicateDecisions(input.decisions)
  };
}

function previewPage(value: unknown): number {
  const page = value === undefined ? 1 : value;
  if (
    typeof page !== "number" ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 500
  ) {
    invalid("page", "Must be an integer between 1 and 500");
  }
  return page;
}

function previewPageSize(
  value: unknown
): SemanticDuplicatePreviewInput["pageSize"] {
  const pageSize = value === undefined ? 100 : value;
  if (
    typeof pageSize !== "number" ||
    !semanticDuplicatePreviewPageSizes.some(
      (supported) => supported === pageSize
    )
  ) {
    invalid("pageSize", "Must be 100");
  }
  return pageSize as SemanticDuplicatePreviewInput["pageSize"];
}

function duplicateDecisions(
  value: unknown
): readonly SemanticDuplicateGroupDecision[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    invalid("decisions", "Select between 1 and 500 duplicate groups");
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
      invalid(
        `decisions.${groupIndex}.groupId`,
        "Must be a unique preview group identifier"
      );
    }
    groupIds.add(input.groupId);
    const keeper = duplicateDecisionItem(
      input.keeper,
      `decisions.${groupIndex}.keeper`
    );
    if (keywordIds.has(keeper.id)) {
      invalid(`decisions.${groupIndex}.keeper`, "Keyword is duplicated");
    }
    keywordIds.add(keeper.id);
    if (
      !Array.isArray(input.deletions) ||
      input.deletions.length < 1 ||
      input.deletions.length > 500
    ) {
      invalid(
        `decisions.${groupIndex}.deletions`,
        "Select between 1 and 500 phrases for deletion"
      );
    }
    const deletions = input.deletions.map((value, itemIndex) => {
      const item = duplicateDecisionItem(
        value,
        `decisions.${groupIndex}.deletions.${itemIndex}`
      );
      if (keywordIds.has(item.id)) {
        invalid(
          `decisions.${groupIndex}.deletions.${itemIndex}`,
          "Keyword is duplicated"
        );
      }
      keywordIds.add(item.id);
      return item;
    });
    deletionCount += deletions.length;
    return { groupId: input.groupId, keeper, deletions };
  });
  if (deletionCount > 500) {
    invalid("decisions", "Select no more than 500 phrases for deletion");
  }
  return decisions;
}

function duplicateDecisionItem(
  value: unknown,
  field: string
): Readonly<{ readonly id: string; readonly version: number }> {
  const input = exactRecord(value, ["id", "version"]);
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) {
    invalid(`${field}.version`, "Must be a positive integer");
  }
  return {
    id: uuid(input.id, `${field}.id`),
    version: Number(input.version)
  };
}

function duplicateRules(value: unknown): SemanticDuplicateRules {
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
    invalid("rules.analysisMode", "Unsupported analysis mode");
  }
  if (typeof input.caseSensitive !== "boolean") {
    invalid("rules.caseSensitive", "Must be a boolean");
  }
  if (typeof input.ignorePunctuation !== "boolean") {
    invalid("rules.ignorePunctuation", "Must be a boolean");
  }
  if (!Array.isArray(input.ignoredWords) || input.ignoredWords.length > 100) {
    invalid("rules.ignoredWords", "Use no more than 100 ignored words");
  }
  const unique = new Map<string, string>();
  for (const [index, value] of input.ignoredWords.entries()) {
    if (typeof value !== "string") {
      invalid(`rules.ignoredWords.${index}`, "Must be a string");
    }
    const normalized = normalizeText(value);
    if (
      normalized.length === 0 ||
      normalized.length > 80 ||
      !/[\p{L}\p{N}]/u.test(normalized)
    ) {
      invalid(
        `rules.ignoredWords.${index}`,
        "Must contain 1 to 80 characters and at least one letter or number"
      );
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

function duplicateScope(value: unknown): SemanticDuplicateScope {
  const input = exactRecord(value, ["kind", "groupId", "items"]);
  if (
    typeof input.kind !== "string" ||
    !semanticDuplicateScopeKinds.some((kind) => kind === input.kind)
  ) {
    invalid("scope.kind", "Unsupported scope");
  }
  if (input.kind === "PROJECT") {
    if (input.groupId !== undefined || input.items !== undefined) {
      invalid("scope", "Project scope cannot include group or items");
    }
    return { kind: "PROJECT" };
  }
  if (input.kind === "GROUP") {
    if (input.items !== undefined) {
      invalid("scope.items", "Group scope cannot include items");
    }
    return {
      kind: "GROUP",
      groupId: uuid(input.groupId, "scope.groupId")
    };
  }
  if (
    input.groupId !== undefined ||
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 2_000
  ) {
    invalid("scope.items", "Select between 1 and 2000 keywords");
  }
  const items = input.items.map((value, index) => {
    const item = exactRecord(value, ["id", "version"]);
    if (!Number.isSafeInteger(item.version) || Number(item.version) < 1) {
      invalid(`scope.items.${index}.version`, "Must be a positive integer");
    }
    return {
      id: uuid(item.id, `scope.items.${index}.id`),
      version: Number(item.version)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    invalid("scope.items", "Duplicate keywords are not allowed");
  }
  return { kind: "SELECTION", items };
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "Must be an object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !keys.includes(key))) {
    invalid("$", "Contains unsupported fields");
  }
  return input;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "Must be a UUID");
  return assertUuid(value, field);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_SEMANTIC_DUPLICATES", message);
}
