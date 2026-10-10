import type { Prisma, SemanticImportStatus } from "../generated/prisma/client.js";
import { semanticImportMaxPublishAttempts } from "../imports/semantic-import-limits.js";
import type { AdminOperationStatusGroup } from "@seo-platform/contracts";
import type { AdminJob } from "./operation-activity.service.js";

export const adminImportSelect = {
  id: true, workspaceId: true, projectId: true, actorId: true,
  status: true, stage: true, totalRows: true, validRows: true, errorRows: true,
  progressBytes: true, totalBytes: true, failure: true, resultSummary: true,
  publishingAttempts: true, parsingStartedAt: true, publishingCompletedAt: true,
  cancelRequestedAt: true, createdAt: true, updatedAt: true
} as const;
type AdminImport = Prisma.SemanticImportGetPayload<{ select: typeof adminImportSelect }>;

const importStatuses = {
  QUEUED: "QUEUED", PARSING: "RUNNING", AWAITING_MAPPING: "AWAITING_APPROVAL",
  VALIDATING: "RUNNING", AWAITING_CONFIRMATION: "AWAITING_APPROVAL",
  READY_TO_PUBLISH: "QUEUED", PUBLISHING: "RUNNING", COMPLETED: "COMPLETED",
  FAILED: "FAILED_FINAL", CANCEL_REQUESTED: "CANCEL_REQUESTED", CANCELLED: "CANCELLED"
} as const satisfies Readonly<Record<SemanticImportStatus, AdminJob["status"]>>;

export function adminImportStatusWhere(group: AdminOperationStatusGroup): Prisma.SemanticImportWhereInput {
  if (group === "ALL") return {};
  return { status: { in: (Object.keys(importStatuses) as SemanticImportStatus[]).filter((status) => {
    const projected = importStatuses[status];
    if (group === "ATTENTION") return projected === "FAILED_FINAL";
    const terminal = projected === "COMPLETED" || projected === "CANCELLED";
    return group === "COMPLETED" ? terminal : !terminal && projected !== "FAILED_FINAL";
  }) } };
}

/** Adapt the import's durable state to the common read model without creating another Job. */
export function adminImportJob(row: AdminImport): AdminJob {
  const status = importStatuses[row.status];
  const parsing = row.status === "QUEUED" || row.status === "PARSING";
  const published = /^(?:publishing_chunks|publishing_links):(\d+):(\d+):/u.exec(row.stage);
  const terminal = status === "COMPLETED" || status === "CANCELLED" || status === "FAILED_FINAL";
  const result = row.resultSummary && typeof row.resultSummary === "object" && !Array.isArray(row.resultSummary) ? row.resultSummary : {};
  const count = (value: unknown) => typeof value === "string" && /^\d+$/u.test(value) ? BigInt(value) : 0n;
  return {
    id: row.id, workspaceId: row.workspaceId, projectId: row.projectId, actorId: row.actorId,
    type: "SEMANTIC_IMPORT", status, stage: row.stage.split(":")[0]!,
    provider: null, credentialMode: "PLATFORM_INCLUDED", scopeSnapshot: {}, providerProgressPercent: null,
    progressCurrent: parsing ? row.progressBytes : published ? BigInt(published[1]!) : status === "COMPLETED" ? row.totalRows : row.validRows + row.errorRows,
    progressTotal: parsing ? row.totalBytes : published ? BigInt(published[2]!) : row.totalRows,
    progressUnit: parsing ? "bytes" : "rows",
    resultSummary: { processed: row.totalRows.toString(), failed: row.errorRows.toString(),
      succeeded: (count(result.createdKeywords) + count(result.updatedKeywords)).toString() },
    errorSummary: row.failure, actualCostMicro: null, currency: null,
    attempt: row.publishingAttempts, maxAttempts: semanticImportMaxPublishAttempts,
    createdAt: row.createdAt, queuedAt: row.createdAt, startedAt: row.parsingStartedAt,
    finishedAt: terminal ? row.publishingCompletedAt ?? row.cancelRequestedAt ?? row.updatedAt : null,
    updatedAt: row.updatedAt
  };
}
