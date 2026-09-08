import type { SemanticOperationGroup } from "../components/semantic-operation-scope";
import type { FrequencyCollectionSummary, FrequencyOperationResult } from "@seo-platform/contracts";
import { frequencyCollectionKeywordLimit } from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "./browser-api.ts";

export interface FrequencyRetryDraft {
  readonly collection: FrequencyCollectionSummary;
  readonly groups: readonly SemanticOperationGroup[];
  readonly selections: readonly { id: string; version: number; label: string }[];
}
/** A new collection uses current keyword versions and gets a fresh price confirmation. */
export async function prepareFrequencyRetry(projectId: string, jobId: string, signal: AbortSignal): Promise<FrequencyRetryDraft> {
  const selections: { id: string; version: number; label: string }[] = [];
  const seen = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, collection: FrequencyCollectionSummary | undefined;
  for (let pageNumber = 0; pageNumber <= Math.ceil(frequencyCollectionKeywordLimit / 500); pageNumber++) {
    const result = await browserApiRequest<FrequencyOperationResult>(`/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections/${encodeURIComponent(jobId)}/result?limit=500&onlyFailed=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
    if (result.collection.id !== jobId || result.collection.projectId !== projectId || !Array.isArray(result.rows) || result.rows.length > 500 || collection && result.collection.version !== collection.version) throw invalid();
    collection = result.collection;
    if ((collection.credentialMode === "PLATFORM_PAID" && collection.requiresUsageReview !== false) || collection.status === "ACTION_REQUIRED" && collection.credentialMode !== "PLATFORM_PAID") throw new BrowserApiError(409, "PAID_OPERATION_REQUIRES_REVIEW", "Сначала дождитесь проверки предыдущего расхода. Повторная отправка пока недоступна.");
    if (!["FAILED_FINAL", "PARTIALLY_COMPLETED", "ACTION_REQUIRED"].includes(collection.status)) throw invalid();
    for (const row of result.rows) {
      if (row.status !== "FAILED_FINAL" || row.keywordAvailable === false || row.keywordVersion === undefined) continue;
      if (typeof row.keywordId !== "string" || !Number.isSafeInteger(row.keywordVersion) || row.keywordVersion < 1 || typeof row.keyword !== "string" || !row.keyword || seen.has(row.keywordId)) throw invalid();
      seen.add(row.keywordId); selections.push({ id: row.keywordId, version: row.keywordVersion, label: row.keyword });
      if (selections.length > frequencyCollectionKeywordLimit) throw invalid();
    }
    if (!result.page.hasNext) {
      if (!selections.length) throw new BrowserApiError(409, "NO_RETRYABLE_KEYWORDS", "Нет доступных запросов с ошибками. Удалённые запросы не отправляются повторно.");
      const groups = await browserApiRequest<readonly SemanticOperationGroup[]>(`/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`, { signal });
      if (!Array.isArray(groups)) throw invalid();
      return { collection, selections, groups };
    }
    if (!result.page.nextCursor || cursors.has(result.page.nextCursor)) throw invalid();
    cursor = result.page.nextCursor; cursors.add(cursor);
  }
  throw invalid();
}
function invalid() { return new BrowserApiError(409, "RETRY_SCOPE_CHANGED", "Состав операции изменился. Обновите список и повторите подготовку."); }
