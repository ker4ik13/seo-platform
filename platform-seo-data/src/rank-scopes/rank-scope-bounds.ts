import type { Prisma } from "../generated/prisma/client.js";

export const MAX_RANK_SCOPE_ENTRIES = 1_000;

/**
 * Arsenkin does not publish a positions-specific phrase length. Its official
 * Projects API accepts at most 500 characters per keyword, so the first
 * positions slice applies that conservative provider-derived ceiling.
 */
export const MAX_RANK_KEYWORD_CHARACTERS = 500;
export const MAX_RANK_KEYWORD_UTF8_BYTES =
  MAX_RANK_KEYWORD_CHARACTERS * 4;
export const MAX_RANK_SCOPE_UTF8_BYTES =
  MAX_RANK_SCOPE_ENTRIES * MAX_RANK_KEYWORD_UTF8_BYTES;

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
