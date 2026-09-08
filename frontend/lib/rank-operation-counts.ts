import type { RankOperationResult } from "@seo-platform/contracts";

export interface RankOperationCounts {
  readonly found: number;
  readonly notFound: number;
  readonly failed: number;
}

/**
 * Uses manifest-wide server counters while a job is active and switches to
 * the immutable terminal receipt after finalization. Cursor-loaded rows are
 * deliberately not part of this calculation.
 */
export function rankOperationCounts(
  result: Pick<RankOperationResult, "counts" | "job">
): RankOperationCounts {
  const current = Number(result.job.progress.current);
  const found = Number(
    result.job.result?.foundCount ?? result.counts.foundCount
  );
  const notFound = Number(
    result.job.result?.notFoundCount ?? result.counts.notFoundCount
  );
  return {
    found,
    notFound,
    failed: Number(
      result.job.result?.failedCount ??
      Math.max(0, current - found - notFound)
    )
  };
}
