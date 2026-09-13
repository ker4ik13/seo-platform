import { parseRankEstimate } from "./rank-estimates.ts";
import { parseRankJobSummary } from "./rank-jobs.ts";
import { rankTargetBatchSignature, type RankTargetBatch } from "./rank-target-batch.ts";
import { uniqueRankTargets, type RankTarget } from "./rank-targets.ts";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function key(workspaceId: string, projectId: string, competitors: boolean) { return `rank-target-batch:v1:${workspaceId}:${projectId}:${competitors ? "competitors" : "positions"}`; }

/** Only public estimates/IDs/settings, never credentials or keyword text. */
export function persistRankTargetBatch(storage: StoragePort, batch: RankTargetBatch): void {
  const saved = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), batch });
  if (saved.length > 3_000_000) throw new Error("Набор слишком большой для безопасного восстановления в браузере. Разделите его на несколько запусков.");
  try { storage.setItem(key(batch.input.workspaceId, batch.input.projectId, batch.input.competitorMode), saved); }
  catch { throw new Error("Не удалось сохранить защиту от повторного запуска. Освободите хранилище браузера и повторите попытку."); }
}
export function clearRankTargetBatch(storage: StoragePort, workspaceId: string, projectId: string, competitors: boolean): void {
  try { storage.removeItem(key(workspaceId, projectId, competitors)); } catch { /* Server receipts remain authoritative. */ }
}
export function readRankTargetBatch(storage: StoragePort, workspaceId: string, projectId: string, competitors: boolean): RankTargetBatch | undefined {
  try {
    const raw = storage.getItem(key(workspaceId, projectId, competitors));
    if (!raw || raw.length > 3_000_000) return undefined;
    const saved = JSON.parse(raw) as { version: number; savedAt: string; batch: RankTargetBatch };
    const batch = saved.batch, input = batch.input;
    if (saved.version !== 1 || !Number.isFinite(Date.parse(saved.savedAt)) ||
      input.workspaceId !== workspaceId || input.projectId !== projectId || input.competitorMode !== competitors ||
      !Array.isArray(input.keywordIds) || !input.keywordIds.length || input.keywordIds.length > 15_000 ||
      input.keywordIds.some(id => !uuid(id)) || new Set(input.keywordIds).size !== input.keywordIds.length ||
      !Number.isSafeInteger(input.selectedKeywordCount) || input.selectedKeywordCount < 1 || input.selectedKeywordCount > input.keywordIds.length ||
      !["ARSENKIN", "XMLSTOCK"].includes(input.source.provider) || typeof input.source.id !== "string" ||
      (input.saveContexts !== undefined && typeof input.saveContexts !== "boolean") ||
      (input.forceCreateContexts !== undefined && typeof input.forceCreateContexts !== "boolean") ||
      (input.contextName !== undefined && (typeof input.contextName !== "string" || !input.contextName.trim() || input.contextName.length > 160)) ||
      (input.forceCreateContexts === true && (input.saveContexts !== true || !input.contextName)) ||
      !Array.isArray(batch.entries) || batch.entries.length !== uniqueRankTargets(input.targets).length ||
      batch.signature !== rankTargetBatchSignature(input)) return undefined;
    const targets = uniqueRankTargets(input.targets);
    for (const [index, entry] of batch.entries.entries()) {
      const target = targets[index]!;
      if (entry.draft.regionCode !== target.regionCode || entry.draft.device !== target.device ||
        !entry.context || entry.context.projectId !== projectId || entry.context.workspaceId !== workspaceId || !uuid(entry.context.id) ||
        !/^semantic-tracking-context:[0-9a-f-]{36}$/u.test(entry.createKey) || !/^semantic-tracking-scope:[0-9a-f-]{36}$/u.test(entry.assignmentKey) ||
        (entry.runKey !== undefined && !/^rank-run:[0-9a-f-]{36}$/u.test(entry.runKey))) return undefined;
      if (entry.estimate) entry.estimate = parseRankEstimate(entry.estimate, { projectId, trackingContextId: entry.context.id });
      if (entry.runKey && !entry.estimate) return undefined;
      if (entry.job) entry.job = parseRankJobSummary(entry.job, { workspaceId, projectId, trackingContextId: entry.context.id });
      delete entry.error;
    }
    if (!batch.entries.some(entry => entry.runKey || entry.job) || batch.entries.every(entry => entry.job)) return undefined;
    return { ...batch, preparing: false };
  } catch { return undefined; }
}

export function writeRankTargetPreference(storage: StoragePort, projectId: string, engine: string, competitors: boolean, targets: readonly RankTarget[]): void {
  try { storage.setItem(`rank-targets:v1:${projectId}:${engine}:${competitors}`, JSON.stringify(uniqueRankTargets(targets))); } catch { /* Preference is optional; pending paid receipts are not. */ }
}
export function readRankTargetPreference(storage: StoragePort, projectId: string, engine: string, competitors: boolean): readonly RankTarget[] | undefined {
  try { const text = storage.getItem(`rank-targets:v1:${projectId}:${engine}:${competitors}`); if (!text || text.length > 50_000) return undefined; return uniqueRankTargets(JSON.parse(text) as RankTarget[]); } catch { return undefined; }
}
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value); }
