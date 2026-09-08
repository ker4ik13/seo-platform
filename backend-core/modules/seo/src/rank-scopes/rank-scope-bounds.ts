import { rankCommandKeywordLimit } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export const MAX_RANK_SCOPE_ENTRIES = rankCommandKeywordLimit;
export const RANK_SCOPE_ASSIGNMENT_PAGE_SIZE = 5_000;
export const RANK_SCOPE_ASSIGNMENT_SELECT = {
  id: true, keywordId: true,
  keyword: { select: { version: true, textOriginal: true, language: true } }
} as const satisfies Prisma.TrackingContextKeywordAssignmentSelect;
export type RankScopeAssignment = Prisma.TrackingContextKeywordAssignmentGetPayload<{ select: typeof RANK_SCOPE_ASSIGNMENT_SELECT }>;

/**
 * Arsenkin does not publish a positions-specific phrase length. Its official
 * Projects API accepts at most 500 characters per keyword, so the first
 * positions slice applies that conservative provider-derived ceiling.
 */
export const MAX_RANK_KEYWORD_CHARACTERS = 500;
export const MAX_RANK_KEYWORD_UTF8_BYTES =
  MAX_RANK_KEYWORD_CHARACTERS * 4;
export const MAX_RANK_SCOPE_UTF8_BYTES =
  32 * 1024 * 1024; // Bound materialized text independently of keyword count.

export interface RankScopeBounds {
  readonly assignmentCount: number;
  readonly maxKeywordCharacters: number;
  readonly maxKeywordBytes: number;
  readonly totalKeywordBytes: number;
}

export interface RankScopeIdentity {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contextId: string;
  readonly includeUntracked: boolean;
}

/** Cursor pages also bound Prisma's secondary relation-fetch parameters. */
export async function readRankScopeAssignments(transaction: Prisma.TransactionClient, scope: RankScopeIdentity): Promise<readonly RankScopeAssignment[]> {
  const rows: RankScopeAssignment[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await transaction.trackingContextKeywordAssignment.findMany({ where: {
      workspaceId: scope.workspaceId, projectId: scope.projectId, contextId: scope.contextId, removedAt: null,
      ...(cursor ? { keywordId: { gt: cursor } } : {}),
      keyword: { status: "ACTIVE", ...(scope.includeUntracked ? {} : { isTracked: true }) }
    }, orderBy: { keywordId: "asc" }, take: RANK_SCOPE_ASSIGNMENT_PAGE_SIZE, select: RANK_SCOPE_ASSIGNMENT_SELECT });
    if (page.length > RANK_SCOPE_ASSIGNMENT_PAGE_SIZE || (cursor && page[0] && page[0].keywordId <= cursor)) throw new Error("Rank assignment cursor did not advance");
    rows.push(...page);
    if (rows.length > MAX_RANK_SCOPE_ENTRIES) throw new Error("Rank scope exceeded its materialization bound");
    if (page.length < RANK_SCOPE_ASSIGNMENT_PAGE_SIZE) return rows;
    cursor = page.at(-1)!.keywordId;
  }
}

/**
 * Reads only bounded aggregate metadata. The byte-size check runs before
 * char_length, so an oversized external TOAST value does not need to be
 * decompressed merely to prove that it is ineligible. Text is never
 * materialized in Node before the service decides whether it may fetch the
 * actual keyword rows.
 */
export async function inspectRankScopeBounds(
  transaction: Prisma.TransactionClient,
  scope: RankScopeIdentity
): Promise<RankScopeBounds> {
  const rows = await transaction.$queryRaw<
    Array<{
      assignmentCount: number;
      maxKeywordCharacters: number;
      maxKeywordBytes: string;
      totalKeywordBytes: string;
    }>
  >`
    WITH "bounded_rank_scope" AS (
      SELECT
        CASE
          WHEN octet_length("keyword"."text_original")
            > ${MAX_RANK_KEYWORD_UTF8_BYTES}
          THEN ${MAX_RANK_KEYWORD_CHARACTERS + 1}
          ELSE char_length("keyword"."text_original")
        END AS "keyword_characters",
        octet_length("keyword"."text_original") AS "keyword_bytes"
      FROM "tracking_context_keyword_assignments" AS "assignment"
      INNER JOIN "keywords" AS "keyword"
        ON "keyword"."workspace_id" = "assignment"."workspace_id"
       AND "keyword"."project_id" = "assignment"."project_id"
       AND "keyword"."id" = "assignment"."keyword_id"
      WHERE "assignment"."workspace_id" = ${scope.workspaceId}::uuid
        AND "assignment"."project_id" = ${scope.projectId}::uuid
        AND "assignment"."context_id" = ${scope.contextId}::uuid
        AND "assignment"."removed_at" IS NULL
        AND "keyword"."status" = 'ACTIVE'
        AND (${scope.includeUntracked} OR "keyword"."is_tracked" = true)
      ORDER BY "assignment"."keyword_id"
      LIMIT ${MAX_RANK_SCOPE_ENTRIES + 1}
    )
    SELECT
      count(*)::integer AS "assignmentCount",
      COALESCE(max("keyword_characters"), 0)::integer
        AS "maxKeywordCharacters",
      COALESCE(max("keyword_bytes"), 0)::text AS "maxKeywordBytes",
      COALESCE(sum("keyword_bytes"), 0)::text AS "totalKeywordBytes"
    FROM "bounded_rank_scope"
  `;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    !Number.isSafeInteger(row.assignmentCount) ||
    row.assignmentCount < 0 ||
    !Number.isSafeInteger(row.maxKeywordCharacters) ||
    row.maxKeywordCharacters < 0
  ) {
    throw new Error("Unable to inspect rank execution scope");
  }
  return {
    assignmentCount: row.assignmentCount,
    maxKeywordCharacters: row.maxKeywordCharacters,
    maxKeywordBytes: decimalSafeInteger(
      row.maxKeywordBytes,
      "maximum keyword byte length"
    ),
    totalKeywordBytes: decimalSafeInteger(
      row.totalKeywordBytes,
      "total keyword byte length"
    )
  };
}

export async function withRankScopeReadPlan<T>(transaction: Prisma.TransactionClient, scope: RankScopeIdentity, read: () => Promise<T>): Promise<T> {
  // A newly imported project's planner statistics may still be empty. On a
  // 50k cold scope PostgreSQL can choose a quadratic nested loop before the
  // first autovacuum ANALYZE. Count assignments using the existing scope index
  // first, then prefer a hash/merge join only for this bounded read.
  const [plan] = await transaction.$queryRaw<{ assignmentCount: number; nestedLoops: string; jit: string; statementTimeout: string }[]>`
    SELECT count(*)::integer AS "assignmentCount",
      current_setting('enable_nestloop') AS "nestedLoops",
      current_setting('jit') AS jit,
      current_setting('statement_timeout') AS "statementTimeout"
    FROM (SELECT 1 FROM tracking_context_keyword_assignments
      WHERE workspace_id = ${scope.workspaceId}::uuid AND project_id = ${scope.projectId}::uuid
        AND context_id = ${scope.contextId}::uuid AND removed_at IS NULL LIMIT 5000) AS rank_scope_plan
  `;
  if (!plan || !Number.isSafeInteger(plan.assignmentCount) || plan.assignmentCount < 0) throw new Error("Unable to inspect rank query plan bounds");
  const large = plan.assignmentCount >= 5000;
  if (large) await transaction.$queryRaw`SELECT set_config('enable_nestloop', 'off', true), set_config('jit', 'off', true), set_config('statement_timeout', '20000', true)`;
  try { return await read(); } finally {
    if (large) await transaction.$queryRaw`SELECT set_config('enable_nestloop', ${plan.nestedLoops}, true), set_config('jit', ${plan.jit}, true), set_config('statement_timeout', ${plan.statementTimeout}, true)`.catch(() => { /* A failed transaction rolls back its local settings. */ });
  }
}


export function rankScopeIsMaterializable(
  bounds: RankScopeBounds
): boolean {
  return (
    bounds.assignmentCount <= MAX_RANK_SCOPE_ENTRIES &&
    bounds.maxKeywordCharacters <= MAX_RANK_KEYWORD_CHARACTERS &&
    bounds.maxKeywordBytes <= MAX_RANK_KEYWORD_UTF8_BYTES &&
    bounds.totalKeywordBytes <= MAX_RANK_SCOPE_UTF8_BYTES
  );
}

function decimalSafeInteger(value: string, field: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Rank scope ${field} is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Rank scope ${field} is outside the safe range`);
  }
  return parsed;
}
