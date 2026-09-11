import type { RankOperationResult } from "@seo-platform/contracts";
import { rankCommandKeywordLimit } from "@seo-platform/contracts";
import type { SemanticOperationGroup } from "../components/semantic-operation-scope";
import type { TrackingContextDraft } from "./tracking-contexts";
import { browserApiRequest, BrowserApiError } from "./browser-api.ts";
import {
  searchContextDisplayName,
  searchRegionDisplayName
} from "./seo-regions.ts";

export interface RankRetryDraft {
  readonly result: RankOperationResult;
  readonly groups: readonly SemanticOperationGroup[];
  readonly selections: readonly { id: string; version: number; label: string }[];
}
/** Only reads the old run. Its immutable results and paid grants are never reopened. */
export async function prepareRankRetry(projectId: string, jobId: string, signal: AbortSignal): Promise<RankRetryDraft> {
  const selections: { id: string; version: number; label: string }[] = [];
  const seen = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, initial: RankOperationResult | undefined;
  for (let page = 0; page <= Math.ceil(rankCommandKeywordLimit / 500); page++) {
    const result = await browserApiRequest<RankOperationResult>(`/app/api/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}/result?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
    if (result.jobId !== jobId || result.job.id !== jobId || result.job.projectId !== projectId || !Array.isArray(result.rows) || result.rows.length > 500) throw invalid();
    if (result.job.status !== "PARTIALLY_COMPLETED" || Number(result.job.result.submitOutcomeUnknownCount) !== 0) throw new BrowserApiError(409, "PAID_OPERATION_REQUIRES_REVIEW", "Сначала дождитесь проверки предыдущего расхода. Повторная отправка пока недоступна.");
    if (initial && (JSON.stringify(initial.execution) !== JSON.stringify(result.execution) || JSON.stringify(initial.job.result) !== JSON.stringify(result.job.result))) throw invalid();
    initial ??= result;
    for (const row of result.rows) {
      if (typeof row.keywordId !== "string" || seen.has(row.keywordId)) throw invalid();
      seen.add(row.keywordId);
      // NOT_FOUND is a successful paid result, never a missing measurement.
      if (row.state !== "PENDING" || row.keywordAvailable === false || row.keywordVersion === undefined) continue;
      if (!Number.isSafeInteger(row.keywordVersion) || row.keywordVersion < 1 || !row.keyword) throw invalid();
      selections.push({ id: row.keywordId, version: row.keywordVersion, label: row.keyword });
    }
    if (seen.size > rankCommandKeywordLimit) throw invalid();
    if (!result.page.hasNext) {
      if (!selections.length) throw new BrowserApiError(409, "NO_RETRYABLE_KEYWORDS", "Нет доступных запросов с ошибками. Удалённые запросы не отправляются повторно.");
      const groups = await browserApiRequest<readonly SemanticOperationGroup[]>(`/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`, { signal });
      if (!Array.isArray(groups)) throw invalid();
      return { result: initial, groups, selections };
    }
    if (!result.page.nextCursor || cursors.has(result.page.nextCursor)) throw invalid();
    cursor = result.page.nextCursor; cursors.add(cursor);
  }
  throw invalid();
}

export function rankRetryContextDraft(result: RankOperationResult): TrackingContextDraft {
  const { execution } = result;
  const rule = execution.domainMatchRule;
  return {
    name: searchContextDisplayName(
      result.contextName,
      execution.searchEngine,
      execution.regionCode
    ),
    searchEngine: execution.searchEngine,
    countryCode: execution.countryCode,
    regionCode: execution.regionCode ?? "",
    regionLabel: execution.regionCode
      ? searchRegionDisplayName(execution.searchEngine, execution.regionCode)
      : "",
    language: execution.language,
    device: execution.device,
    depth: execution.depth,
    domainMatchMode: rule.mode,
    domainMatchValue: rule.mode === "SPECIFIC_URL" || rule.mode === "URL_PREFIX" ? rule.value : "",
    safeSearch: execution.safeSearch,
    searchSource: result.job.searchSource ?? "LIVE",
    includeUntracked: true,
    scopeMode: "KEYWORDS",
    groupIds: []
  };
}
function invalid() { return new BrowserApiError(409, "RETRY_SCOPE_CHANGED", "Состав операции изменился. Обновите список и повторите подготовку."); }
