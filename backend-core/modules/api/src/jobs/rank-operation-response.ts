import {
  operationResultItemStatuses,
  rankProviderKeywordLimit,
  type InternalRankOperationScope,
  type InternalRankOperationScopeItem
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function scopedRankOperationScope(
  value: unknown,
  workspaceId: string,
  projectId: string,
  jobId: string,
  limit: number,
  cursor?: string
): InternalRankOperationScope {
  const input = exact(value, ["workspaceId", "projectId", "jobId", "items", "page"]);
  const page = exact(input.page, ["hasNext"], ["nextCursor"]);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    uuid(input.jobId) !== jobId ||
    !Array.isArray(input.items) ||
    input.items.length > limit ||
    typeof page.hasNext !== "boolean" ||
    (page.hasNext &&
      (typeof page.nextCursor !== "string" || input.items.length !== limit)) ||
    (!page.hasNext && page.nextCursor !== undefined)
  ) {
    invalid();
  }

  const sequences = new Set<number>();
  const items = input.items.map((value): InternalRankOperationScopeItem => {
    const item = exact(
      value,
      ["sequence", "status", "pollAttempts"],
      ["errorCode"]
    );
    const sequence = integer(item.sequence, 0, rankProviderKeywordLimit - 1);
    const pollAttempts = integer(item.pollAttempts, 0, Number.MAX_SAFE_INTEGER);
    if (
      sequences.has(sequence) ||
      typeof item.status !== "string" ||
      !operationResultItemStatuses.includes(item.status as never) ||
      (item.errorCode !== undefined &&
        (typeof item.errorCode !== "string" ||
          !/^[A-Z0-9_]{1,100}$/u.test(item.errorCode)))
    ) {
      invalid();
    }
    sequences.add(sequence);
    return {
      sequence,
      status: item.status as InternalRankOperationScopeItem["status"],
      pollAttempts,
      ...(typeof item.errorCode === "string"
        ? { errorCode: item.errorCode }
        : {})
    };
  });
  const firstSequence = cursor === undefined ? 0 : Number(cursor) + 1;
  if (
    items.some((item, index) => item.sequence !== firstSequence + index) ||
    (page.hasNext && page.nextCursor !== String(items.at(-1)?.sequence))
  ) {
    invalid();
  }
  return {
    workspaceId,
    projectId,
    jobId,
    items,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {})
    }
  };
}

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in input)) ||
    Object.keys(input).some((key) => !allowed.has(key))
  ) {
    invalid();
  }
  return input;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid();
  }
  return Number(value);
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs returned an invalid rank result scope",
    retryable: true
  });
}
