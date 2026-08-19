import { HttpException, HttpStatus } from "@nestjs/common";
import type { AiAnswerSearchEngine } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";

export interface PreviousAiAnswerPositionAnchor {
  readonly keywordId: string;
  readonly searchEngine: AiAnswerSearchEngine;
  readonly observedAt: Date;
  readonly snapshotId: string;
}

interface PreviousAiAnswerPositionRow extends PreviousAiAnswerPositionAnchor {
  readonly previousPosition: number;
}

export function previousAiAnswerPositionKey(
  keywordId: string,
  searchEngine: AiAnswerSearchEngine,
  observedAt: Date,
  snapshotId: string
): string {
  return `${keywordId}:${searchEngine}:${observedAt.toISOString()}:${snapshotId}`;
}

/**
 * Looks behind each immutable AI snapshot across every region/device context.
 * A context change must not make a canonical keyword look new again.
 */
export async function previousAiAnswerPositions(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  anchors: readonly PreviousAiAnswerPositionAnchor[]
): Promise<ReadonlyMap<string, number>> {
  if (anchors.length === 0) return new Map();
  const serializedAnchors = anchors.map((anchor) => ({
    keyword_id: anchor.keywordId,
    search_engine: anchor.searchEngine,
    observed_at: anchor.observedAt.toISOString(),
    snapshot_id: anchor.snapshotId
  }));
  const rows = await prisma.$queryRaw<readonly PreviousAiAnswerPositionRow[]>`
    WITH anchors AS (
      SELECT
        anchor.keyword_id,
        anchor.search_engine,
        anchor.observed_at,
        anchor.snapshot_id
      FROM jsonb_to_recordset(${JSON.stringify(serializedAnchors)}::jsonb) AS anchor(
        keyword_id uuid,
        search_engine text,
        observed_at timestamptz,
        snapshot_id uuid
      )
    )
    SELECT
      anchors.keyword_id::text AS "keywordId",
      anchors.search_engine AS "searchEngine",
      anchors.observed_at AS "observedAt",
      anchors.snapshot_id::text AS "snapshotId",
      previous.position AS "previousPosition"
    FROM anchors
    INNER JOIN LATERAL (
      SELECT snapshot.position
      FROM ai_answer_snapshots snapshot
      WHERE snapshot.workspace_id = ${workspaceId}::uuid
        AND snapshot.project_id = ${projectId}::uuid
        AND snapshot.keyword_id = anchors.keyword_id
        AND snapshot.search_engine = anchors.search_engine
        AND snapshot.site_found = TRUE
        AND snapshot.position IS NOT NULL
        AND (snapshot.observed_at, snapshot.id) <
            (anchors.observed_at, anchors.snapshot_id)
      ORDER BY snapshot.observed_at DESC, snapshot.id DESC
      LIMIT 1
    ) previous ON TRUE
  `;
  const expectedKeys = new Set(
    anchors.map((anchor) =>
      previousAiAnswerPositionKey(
        anchor.keywordId,
        anchor.searchEngine,
        anchor.observedAt,
        anchor.snapshotId
      )
    )
  );
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = previousAiAnswerPositionKey(
      row.keywordId,
      row.searchEngine,
      row.observedAt,
      row.snapshotId
    );
    if (
      !expectedKeys.has(key) ||
      !Number.isSafeInteger(row.previousPosition) ||
      row.previousPosition <= 0 ||
      result.has(key)
    ) {
      throw new HttpException(
        "Invalid previous AI position projection",
        HttpStatus.BAD_GATEWAY
      );
    }
    result.set(key, row.previousPosition);
  }
  return result;
}
