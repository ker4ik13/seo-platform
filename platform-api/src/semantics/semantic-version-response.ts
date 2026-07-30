import {
  semanticVersionChangeStates,
  semanticVersionReasons,
  type SemanticVersionChangePreview,
  type SemanticVersionListItem,
  type SemanticVersionUndoPreview,
  type SemanticVersionUndoResult
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function semanticVersionsResponse(
  value: unknown
): readonly SemanticVersionListItem[] {
  if (!Array.isArray(value) || value.length > 100) invalid();
  const versions = value.map(semanticVersionResponse);
  if (
    new Set(versions.map(({ id }) => id)).size !== versions.length ||
    versions.some(
      (item, index) =>
        index > 0 && item.number >= versions[index - 1]!.number
    )
  ) {
    invalid();
  }
  return versions;
}

export function semanticVersionUndoPreviewResponse(
  value: unknown
): SemanticVersionUndoPreview {
  const input = exactRecord(value, [
    "version",
    "applicable",
    "conflicted",
    "unsupported",
    "changes"
  ]);
  const changes = semanticVersionChanges(input.changes);
  const counts = undoCounts(input, changes);
  return {
    version: semanticVersionResponse(input.version),
    ...counts,
    changes
  };
}

export function semanticVersionUndoResultResponse(
  value: unknown
): SemanticVersionUndoResult {
  const input = exactRecord(value, [
    "sourceVersionId",
    "createdVersion",
    "applied",
    "conflicted",
    "unsupported",
    "changes"
  ]);
  if (!uuid(input.sourceVersionId)) invalid();
  const changes = semanticVersionChanges(input.changes);
  const counts = undoCounts(
    {
      applicable: input.applied,
      conflicted: input.conflicted,
      unsupported: input.unsupported
    },
    changes
  );
  if (counts.applicable !== changes.filter(({ state }) => state === "APPLICABLE").length) {
    invalid();
  }
  return {
    sourceVersionId: input.sourceVersionId,
    ...(input.createdVersion === undefined
      ? {}
      : { createdVersion: semanticVersionResponse(input.createdVersion) }),
    applied: counts.applicable,
    conflicted: counts.conflicted,
    unsupported: counts.unsupported,
    changes
  };
}

function semanticVersionResponse(value: unknown): SemanticVersionListItem {
  const input = exactRecord(value, [
    "id",
    "number",
    "reason",
    "actorId",
    "sourceJobId",
    "parentVersionId",
    "summary",
    "affectedCount",
    "reversible",
    "finalizedAt",
    "createdAt"
  ]);
  if (
    !uuid(input.id) ||
    !Number.isSafeInteger(input.number) ||
    Number(input.number) < 1 ||
    typeof input.reason !== "string" ||
    !semanticVersionReasons.some((reason) => reason === input.reason) ||
    !uuid(input.actorId) ||
    (input.sourceJobId !== undefined && !uuid(input.sourceJobId)) ||
    (input.parentVersionId !== undefined && !uuid(input.parentVersionId)) ||
    typeof input.summary !== "string" ||
    input.summary.length > 500 ||
    !Number.isSafeInteger(input.affectedCount) ||
    Number(input.affectedCount) < 0 ||
    typeof input.reversible !== "boolean" ||
    (input.finalizedAt !== undefined && !validDate(input.finalizedAt)) ||
    !validDate(input.createdAt) ||
    (input.reversible && input.finalizedAt === undefined)
  ) {
    invalid();
  }
  return {
    id: input.id,
    number: Number(input.number),
    reason: input.reason,
    actorId: input.actorId,
    ...(typeof input.sourceJobId === "string"
      ? { sourceJobId: input.sourceJobId }
      : {}),
    ...(typeof input.parentVersionId === "string"
      ? { parentVersionId: input.parentVersionId }
      : {}),
    summary: input.summary,
    affectedCount: Number(input.affectedCount),
    reversible: input.reversible,
    ...(typeof input.finalizedAt === "string"
      ? { finalizedAt: input.finalizedAt }
      : {}),
    createdAt: input.createdAt
  } as SemanticVersionListItem;
}

function semanticVersionChanges(
  value: unknown
): readonly SemanticVersionChangePreview[] {
  if (!Array.isArray(value) || value.length > 500) invalid();
  const changes = value.map((item) => {
    const input = exactRecord(item, [
      "entityType",
      "entityId",
      "operation",
      "state",
      "expectedCurrentVersion",
      "currentVersion",
      "conflictCode"
    ]);
    if (
      input.entityType !== "KEYWORD" ||
      !uuid(input.entityId) ||
      !["CREATE", "UPDATE", "DELETE"].includes(String(input.operation)) ||
      typeof input.state !== "string" ||
      !semanticVersionChangeStates.some((state) => state === input.state) ||
      !positiveInteger(input.expectedCurrentVersion) ||
      (input.currentVersion !== undefined &&
        !positiveInteger(input.currentVersion)) ||
      (input.conflictCode !== undefined &&
        (typeof input.conflictCode !== "string" ||
          !/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.conflictCode)))
    ) {
      invalid();
    }
    return {
      entityType: "KEYWORD" as const,
      entityId: input.entityId,
      operation: input.operation as "CREATE" | "UPDATE" | "DELETE",
      state: input.state,
      expectedCurrentVersion: Number(input.expectedCurrentVersion),
      ...(typeof input.currentVersion === "number"
        ? { currentVersion: input.currentVersion }
        : {}),
      ...(typeof input.conflictCode === "string"
        ? { conflictCode: input.conflictCode }
        : {})
    } as SemanticVersionChangePreview;
  });
  if (
    new Set(changes.map(({ entityId }) => entityId)).size !== changes.length
  ) {
    invalid();
  }
  return changes;
}

function undoCounts(
  input: Readonly<Record<string, unknown>>,
  changes: readonly SemanticVersionChangePreview[]
): Readonly<{
  applicable: number;
  conflicted: number;
  unsupported: number;
}> {
  for (const field of ["applicable", "conflicted", "unsupported"]) {
    if (!nonnegativeInteger(input[field])) invalid();
  }
  const applicable = Number(input.applicable);
  const conflicted = Number(input.conflicted);
  const unsupported = Number(input.unsupported);
  if (
    applicable + conflicted + unsupported !== changes.length ||
    applicable !==
      changes.filter(({ state }) => state === "APPLICABLE").length ||
    conflicted !==
      changes.filter(({ state }) => state === "CONFLICTED").length ||
    unsupported !==
      changes.filter(({ state }) => state === "UNSUPPORTED").length
  ) {
    invalid();
  }
  return { applicable, conflicted, unsupported };
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some((key) => !keys.includes(key)) ||
    keys.some(
      (key) =>
        !["sourceJobId", "parentVersionId", "finalizedAt", "createdVersion", "currentVersion", "conflictCode"].includes(
          key
        ) && !(key in input)
    )
  ) {
    invalid();
  }
  return input;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO Data returned an invalid semantic version response",
    retryable: true
  });
}
