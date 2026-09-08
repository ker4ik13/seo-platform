import type { ProjectConnectorCredentialOption, RankEstimate, RankJobSummary, TrackingContextKeywordReplacementResult, TrackingContextSettings, TrackingContextSummary } from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "./browser-api.ts";
import { parseRankEstimate, rankEstimateBlockerLabel, rankEstimateExpired, rankEstimateInput, rankEstimatesApiPath } from "./rank-estimates.ts";
import { parseRankJobSummary, rankJobApiPath, rankJobCreateFeedback, rankRunInput, rankRunsApiPath } from "./rank-jobs.ts";
import { trackingContextApiPath, trackingContextCreateInput, trackingContextMatchesDraft, validateTrackingContextDraft, type TrackingContextDraft } from "./tracking-contexts.ts";
import { rankTargetDraft, uniqueRankTargets, type RankTarget } from "./rank-targets.ts";

export interface RankTargetBatchInput {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly base: TrackingContextDraft;
  readonly targets: readonly RankTarget[];
  readonly keywordIds: readonly string[];
  readonly selectedKeywordCount: number;
  readonly source: ProjectConnectorCredentialOption;
  readonly competitorMode: boolean;
  readonly saveProjectPosition: boolean;
  readonly yandexLiveTurbo: boolean;
  readonly locale?: "ru" | "en";
}
export interface RankTargetBatchEntry {
  readonly draft: TrackingContextDraft;
  readonly createKey: string;
  readonly assignmentKey: string;
  context?: TrackingContextSummary;
  assigned?: boolean;
  estimate?: RankEstimate;
  estimateKey?: string;
  runKey?: string;
  job?: RankJobSummary;
  error?: string;
}
export interface RankTargetBatch {
  readonly signature: string;
  readonly entries: RankTargetBatchEntry[];
  readonly input: RankTargetBatchInput;
  preparing: boolean;
}
type Request = typeof browserApiRequest;
export function rankTargetBatchSignature(input: RankTargetBatchInput): string {
  return JSON.stringify({ ...input, source: { id: input.source.id, mode: input.source.mode, provider: input.source.provider }, keywordIds: [...input.keywordIds].sort(), targets: uniqueRankTargets(input.targets) });
}
export function createRankTargetBatch(input: RankTargetBatchInput): RankTargetBatch {
  return { signature: rankTargetBatchSignature(input), input, preparing: true, entries: uniqueRankTargets(input.targets).map(target => ({ draft: rankTargetDraft(input.base, target, input.competitorMode, input.locale), createKey: `semantic-tracking-context:${crypto.randomUUID()}`, assignmentKey: `semantic-tracking-scope:${crypto.randomUUID()}` })) };
}
export function rankTargetBatchCharge(batch: RankTargetBatch): string {
  return batch.entries.filter(entry => !entry.job).reduce((total, entry) => total + BigInt(entry.estimate?.platformChargeMicro ?? "0"), 0n).toString();
}
export function rankTargetBatchReady(batch: RankTargetBatch): boolean {
  return !batch.preparing && batch.entries.every(entry => entry.job || (entry.estimate?.status === "READY" && entry.estimate.executionAllowed && (entry.runKey || !rankEstimateExpired(entry.estimate.expiresAt, Date.now()))));
}

/** Preparation makes no provider calls. All estimates are shown before launch. */
export async function prepareRankTargetBatch(batch: RankTargetBatch, settings: TrackingContextSettings, changed: () => void, request: Request = browserApiRequest): Promise<void> {
  batch.preparing = true;
  const input = batch.input, provider = input.source.provider === "ARSENKIN" ? "ARSENKIN" : "XMLSTOCK";
  const bytes = new TextEncoder().encode([...input.keywordIds].sort().join("\n"));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  try {
    for (const entry of batch.entries) {
      if (entry.job || entry.runKey) continue;
      delete entry.error;
      try {
        const validation = Object.values(validateTrackingContextDraft(entry.draft))[0];
        if (validation) throw new Error(validation);
        if (!entry.context) {
          const match = settings.contexts.find(context => context.status === "ACTIVE" && trackingContextMatchesDraft(context, entry.draft));
          if (!match && !settings.access.canConfigure) throw new Error("Нет права создавать профили съёма.");
          const context = match ?? await request<TrackingContextSummary>(`/app/api/projects/${input.projectId}/tracking-contexts`, { method: "POST", idempotencyKey: entry.createKey, body: trackingContextCreateInput(entry.draft) });
          const authoritative = await request<TrackingContextSummary>(trackingContextApiPath(input.projectId, context.id));
          if (authoritative.workspaceId !== input.workspaceId || authoritative.projectId !== input.projectId || authoritative.id !== context.id || authoritative.status !== "ACTIVE" || !trackingContextMatchesDraft(authoritative, entry.draft)) throw new Error("Профиль изменился параллельно. Обновите параметры съёма.");
          entry.context = authoritative;
        }
        if (!entry.assigned) {
          const result = await request<TrackingContextKeywordReplacementResult>(`${trackingContextApiPath(input.projectId, entry.context.id)}/keywords`, { method: "PUT", ifMatch: entry.context.version, idempotencyKey: entry.assignmentKey, body: { keywordIds: input.keywordIds } });
          if (result.contextId !== entry.context.id || result.assignedKeywordCount !== input.keywordIds.length || result.keywordSetHash.algorithm !== "SHA_256" || result.keywordSetHash.value !== hash) throw new BrowserApiError(502, "INVALID_RESPONSE", "Не удалось проверить состав запросов профиля.");
          entry.context = { ...entry.context, assignedKeywordCount: result.assignedKeywordCount, version: result.version };
          entry.assigned = true;
        }
        if (!entry.estimate || rankEstimateExpired(entry.estimate.expiresAt, Date.now()) || entry.estimate.status !== "READY") {
          entry.estimateKey ??= `rank-estimate:${crypto.randomUUID()}`;
          const mode = input.yandexLiveTurbo && provider === "XMLSTOCK" && entry.draft.searchEngine === "YANDEX" && entry.draft.searchSource === "LIVE" ? "TURBO" : undefined;
          const payload = await request<unknown>(rankEstimatesApiPath(input.projectId), { method: "POST", idempotencyKey: entry.estimateKey, body: rankEstimateInput(entry.context.id, provider, input.source.id, entry.draft.searchSource, mode, input.competitorMode ? "COMPETITOR_SERP" : undefined, input.competitorMode ? input.saveProjectPosition : undefined) });
          entry.estimate = parseRankEstimate(payload, { projectId: input.projectId, trackingContextId: entry.context.id });
          delete entry.estimateKey;
          if (entry.estimate.scope.contextVersion !== entry.context.version || entry.estimate.scope.configurationVersion !== entry.context.configuration.configurationVersion || entry.estimate.scope.keywordCount !== String(input.selectedKeywordCount)) { delete entry.estimate; throw new Error("Состав или параметры профиля изменились. Рассчитайте съём заново."); }
          if (entry.estimate.status !== "READY" || !entry.estimate.executionAllowed) entry.error = entry.estimate.blockers.map(blocker => rankEstimateBlockerLabel(blocker.code)).join(" ");
        }
      } catch (error) { entry.error = error instanceof Error ? error.message : "Не удалось подготовить съём."; }
      changed();
    }
  } finally { batch.preparing = false; changed(); }
}

/** Receipts and exact idempotency keys survive partial success/network errors. */
export async function launchRankTargetBatch(batch: RankTargetBatch, changed: () => void, request: Request = browserApiRequest): Promise<void> {
  if (!rankTargetBatchReady(batch)) throw new Error("Сначала рассчитайте все выбранные съёмы.");
  for (const entry of batch.entries) {
    if (entry.job) continue;
    if (!entry.estimate || !entry.context) throw new Error("Нет подтверждённой оценки съёма.");
    delete entry.error;
    entry.runKey ??= `rank-run:${crypto.randomUUID()}`;
    // Persist the exact key before HTTP: the process/tab can disappear before
    // any response, including after the server has already committed the job.
    changed();
    const scope = { workspaceId: batch.input.workspaceId, projectId: batch.input.projectId, trackingContextId: entry.context.id };
    try {
      const payload = await request<unknown>(rankRunsApiPath(batch.input.projectId), { method: "POST", idempotencyKey: entry.runKey, body: rankRunInput(entry.estimate.id, entry.estimate.platformChargeMicro) });
      entry.job = parseRankJobSummary(payload, scope);
    } catch (error) {
      const feedback = rankJobCreateFeedback(error, typeof navigator === "undefined" || navigator.onLine);
      if (feedback.action === "ATTACH_EXISTING" && feedback.attachJobId) {
        try { entry.job = parseRankJobSummary(await request<unknown>(rankJobApiPath(batch.input.projectId, feedback.attachJobId)), { ...scope, jobId: feedback.attachJobId }); }
        catch { entry.error = "Не получен статус принятого съёма. Повторите эту же команду."; }
      } else {
        entry.error = feedback.message;
        if (feedback.action === "RECALCULATE" || feedback.action === "NONE") { delete entry.runKey; delete entry.estimate; }
      }
      changed();
      // Stop on an uncertain outcome; a retry replays this key before moving on.
      if (!entry.job) return;
    }
    changed();
  }
}
