import { PrismaPg } from "@prisma/adapter-pg";
import type { OperationalAlertEnvelope } from "@seo-platform/operational-alerts";
import { PrismaClient } from "./generated/prisma/client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RETENTION_MS = 15 * 24 * 60 * 60 * 1_000;
const DELETE_BATCH_SIZE = 500;
const MAX_DELETE_BATCHES = 50;

type JournalDatabase = Pick<PrismaClient, "operationalErrorEvent" | "$executeRaw" | "$disconnect">;

/** Platform-owned, secret-free diagnostic journal for the existing alert receiver. */
export class OperationalErrorJournal {
  private readonly database: JournalDatabase;

  public constructor(
    databaseUrl: string,
    private readonly environment: string,
    private readonly serviceVersion: string,
    database?: JournalDatabase
  ) {
    if (!databaseUrl) throw new Error("PLATFORM_DATABASE_URL is required for the error journal");
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(environment) ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(serviceVersion)) {
      throw new Error("Invalid error journal environment or version");
    }
    this.database = database ?? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: 2_000,
        idleTimeoutMillis: 10_000
      })
    });
  }

  public async record(envelope: OperationalAlertEnvelope): Promise<void> {
    const context = safeJournalContext(envelope.context);
    const workspaceId = contextUuid(context, "workspaceId");
    const projectId = contextUuid(context, "projectId");
    const operationId = contextUuid(context, "operationId") ?? contextUuid(context, "jobId");
    await this.database.operationalErrorEvent.create({
      data: {
        environment: this.environment,
        serviceVersion: this.serviceVersion,
        service: envelope.service,
        source: envelope.source,
        code: envelope.code,
        severity: envelope.severity,
        ...(envelope.fingerprint ? { fingerprint: envelope.fingerprint } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(operationId ? { operationId } : {}),
        ...(context ? { context: { ...context } } : {})
      }
    });
  }

  public async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    let deleted = 0;
    for (let batch = 0; batch < MAX_DELETE_BATCHES; batch += 1) {
      const count = await this.database.$executeRaw`
        DELETE FROM operational_error_events
        WHERE id IN (
          SELECT id FROM operational_error_events
          WHERE occurred_at < ${cutoff}
          ORDER BY occurred_at, id
          LIMIT ${DELETE_BATCH_SIZE}
        )
      `;
      deleted += count;
      if (count < DELETE_BATCH_SIZE) break;
    }
    return deleted;
  }

  public async close(): Promise<void> {
    await this.database.$disconnect();
  }
}

function contextUuid(
  context: OperationalAlertEnvelope["context"],
  key: string
): string | undefined {
  const value = context?.[key];
  return value && UUID.test(value) ? value : undefined;
}

function safeJournalContext(
  context: OperationalAlertEnvelope["context"]
): Readonly<Record<string, string>> | undefined {
  if (!context) return undefined;
  const safe: Record<string, string> = {};
  for (const key of ["workspaceId", "projectId", "jobId", "operationId"] as const) {
    const value = contextUuid(context, key);
    if (value) safe[key] = value;
  }
  for (const key of ["errorCode", "provider", "providerCode", "reasonCode"] as const) {
    const value = context[key];
    if (value && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value)) safe[key] = value;
  }
  if (!safe.errorCode) {
    const prismaCode = /\bP\d{4}\b/u.exec(context.log ?? "")?.[0];
    if (prismaCode) safe.errorCode = prismaCode;
  }
  const httpStatus = context.httpStatus;
  if (httpStatus && /^[1-5][0-9]{2}$/u.test(httpStatus)) safe.httpStatus = httpStatus;
  const requestId = context.requestId;
  if (requestId && /^[A-Za-z0-9_-]{1,100}$/u.test(requestId)) safe.requestId = requestId;
  return Object.keys(safe).length > 0 ? safe : undefined;
}
