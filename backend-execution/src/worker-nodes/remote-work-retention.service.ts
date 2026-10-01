import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { OBJECT_STORAGE, type ObjectStoragePort } from "../storage/object-storage.port.js";

const RECEIPT_DAYS = 7;
const BATCH_SIZE = 100;
interface ExpiredTask {
  readonly id: string;
  readonly workspaceId: string;
  readonly operationId: string;
  readonly command: string;
  readonly resultObjectKey: string | null;
  readonly resultMultipartId: string | null;
  readonly inputObjectKey: string | null;
}

/** Temporary transport receipts are not the persisted domain result or billing ledger. */
@Injectable()
export class RemoteWorkRetentionService {
  private readonly logger = new Logger(RemoteWorkRetentionService.name);
  public constructor(private readonly prisma: PrismaService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort) {}

  public async sweep(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - RECEIPT_DAYS * 24 * 60 * 60_000);
    for (let batch = 0; batch < 10; batch++) {
      const tasks = await this.prisma.$queryRaw<ExpiredTask[]>`
        SELECT t.id, t.workspace_id AS "workspaceId", t.operation_id AS "operationId", t.command,
          t.result_object_key AS "resultObjectKey", t.result_multipart_id AS "resultMultipartId",
          CASE WHEN t.command='EXPORT_FILE' THEN t.payload->>'inputObjectKey' END AS "inputObjectKey"
        FROM public.remote_work_tasks t
        WHERE t.state IN ('COMPLETED','FAILED','ABANDONED') AND t.finished_at <= ${cutoff}
          AND (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=t.job_id AND j.status IN ('COMPLETED','CANCELLED','EXPIRED'))
            OR (t.capability='IMPORT' AND EXISTS (SELECT 1 FROM public.semantic_imports i WHERE i.id=t.operation_id AND i.status IN ('COMPLETED','CANCELLED')))
            OR (t.capability='INSPECTION' AND EXISTS (SELECT 1 FROM public.uploads u WHERE u.id=t.operation_id AND u.status IN ('READY','REJECTED','EXPIRED','ABORTED'))))
        ORDER BY t.finished_at,t.id LIMIT ${BATCH_SIZE}
      `;
      const removed: string[] = [];
      for (const task of tasks) {
        try {
          // Canonical exports are governed by EXPORT_FILE_RETENTION_DAYS,
          // not transport cleanup. Never remove a user's final export here.
          if (task.resultObjectKey?.startsWith(`remote-results/${task.workspaceId}/${task.operationId}/${task.id}/`)) {
            if (task.resultMultipartId) {
              try { await this.storage.abortMultipartUpload("artifacts", task.resultObjectKey, task.resultMultipartId); }
              catch (error) { if (!missingMultipart(error)) throw error; }
            }
            await this.storage.deleteObject("artifacts", task.resultObjectKey);
          } else if (task.resultObjectKey && task.command !== "EXPORT_FILE") {
            throw new Error("Remote artifact is outside its work scope");
          }
          if (task.inputObjectKey) {
            if (!task.inputObjectKey.startsWith(`remote-inputs/${task.workspaceId}/${task.operationId}/`)) throw new Error("Remote input is outside its work scope");
            await this.storage.deleteObject("artifacts", task.inputObjectKey);
          }
          removed.push(task.id);
        } catch { this.logger.warn("Unable to expire a remote transport artifact; next sweep will retry"); }
      }
      if (removed.length) await this.prisma.remoteWorkTask.deleteMany({ where: { id: { in: removed }, state: { in: ["COMPLETED","FAILED","ABANDONED"] }, finishedAt: { lte: cutoff } } });
      if (tasks.length < BATCH_SIZE || removed.length === 0) return;
    }
  }
}

function missingMultipart(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "NoSuchUpload" || value.$metadata?.httpStatusCode === 404;
}
