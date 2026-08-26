import { Injectable } from "@nestjs/common";
import type {
  AdminOperationResultMetrics,
  AdminOperationStatus,
  AdminOperationStatusGroup,
  InternalAdminOperationSearchResult,
  InternalAdminOperationSummary,
  ProjectOperationActivitySummary
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import {
  Prisma,
  type JobStatus
} from "../generated/prisma/client.js";
import { INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE } from "../integrations/integration-credential-validation-job.js";
import type { PlatformAdminOperationQuery } from "./platform-admin-operation-input.js";

const visibleOperationTypes = [
  "FREQUENCY_COLLECTION",
  "MANUAL_RANK_CHECK",
  "AI_ANSWER_COLLECTION",
  "CLUSTERING_RUN",
  "TECHNICAL_CRAWL",
  "KEYWORD_RESEARCH",
  "SEMANTIC_EXPORT"
] as const;

const activeOperationStatuses = [
  "PREPARING",
  "QUEUED",
  "WAITING_RATE_LIMIT",
  "RUNNING",
  "CANCEL_REQUESTED",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
] as const;

const adminActiveStatuses = [
  "ESTIMATING",
  "AWAITING_APPROVAL",
  "RESERVING_BALANCE",
  "PREPARING",
  "QUEUED",
  "WAITING_RATE_LIMIT",
  "RUNNING",
  "PAUSE_REQUESTED",
  "PAUSED",
  "CANCEL_REQUESTED",
  "RETRY_SCHEDULED"
] as const satisfies readonly JobStatus[];
const adminCompletedStatuses = [
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED"
] as const satisfies readonly JobStatus[];
const adminAttentionStatuses = [
  "FAILED_FINAL",
  "ACTION_REQUIRED"
] as const satisfies readonly JobStatus[];
const ADMIN_JOB_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  actorId: true,
  type: true,
  status: true,
  stage: true,
  provider: true,
  progressCurrent: true,
  progressTotal: true,
  progressUnit: true,
  actualCostMicro: true,
  currency: true,
  attempt: true,
  maxAttempts: true,
  errorSummary: true,
  resultSummary: true,
  createdAt: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  updatedAt: true
} as const;

type AdminJob = Prisma.JobGetPayload<{ select: typeof ADMIN_JOB_SELECT }>;

@Injectable()
export class OperationActivityService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string
  ): Promise<readonly ProjectOperationActivitySummary[]> {
    const groups = await this.prisma.job.groupBy({
      by: ["projectId"],
      where: {
        workspaceId,
        projectId: { not: null },
        type: { in: [...visibleOperationTypes] },
        status: { in: [...activeOperationStatuses] }
      },
      _count: { _all: true }
    });
    return groups.flatMap(({ projectId, _count }) =>
      projectId
        ? [{ projectId, activeOperationCount: _count._all }]
        : []
    );
  }

  public async adminList(
    query: PlatformAdminOperationQuery
  ): Promise<InternalAdminOperationSearchResult> {
    const baseWhere: Prisma.JobWhereInput = query.type
      ? { type: query.type }
      : {};
    const statusWhere = statusGroupWhere(query.statusGroup);
    const filteredWhere: Prisma.JobWhereInput = statusWhere
      ? { AND: [baseWhere, statusWhere] }
      : baseWhere;
    const anchor = query.cursor
      ? await this.prisma.job.findUnique({
          where: { id: query.cursor },
          select: { id: true, createdAt: true }
        })
      : undefined;
    const pageWhere: Prisma.JobWhereInput = anchor
      ? {
          AND: [
            filteredWhere,
            {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } }
              ]
            }
          ]
        }
      : filteredWhere;
    const [jobs, total, active, completed, attention, typeGroups] =
      await Promise.all([
        this.prisma.job.findMany({
          where: pageWhere,
          select: ADMIN_JOB_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: query.limit + 1
        }),
        this.prisma.job.count({ where: baseWhere }),
        this.prisma.job.count({
          where: { AND: [baseWhere, adminActiveWhere()] }
        }),
        this.prisma.job.count({
          where: { ...baseWhere, status: { in: [...adminCompletedStatuses] } }
        }),
        this.prisma.job.count({
          where: { AND: [baseWhere, adminAttentionWhere()] }
        }),
        this.prisma.job.groupBy({
          by: ["type"],
          _count: { _all: true }
        })
      ]);
    const page = jobs.slice(0, query.limit);
    return {
      data: page.map(adminOperationSummary),
      ...(jobs.length > query.limit && page.length > 0
        ? { nextCursor: page[page.length - 1]!.id }
        : {}),
      totals: { total, active, completed, attention },
      types: typeGroups
        .map(({ type, _count }) => ({ type, count: _count._all }))
        .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
        .slice(0, 50)
    };
  }
}

function statusGroupWhere(
  group: AdminOperationStatusGroup
): Prisma.JobWhereInput | undefined {
  if (group === "ACTIVE") return adminActiveWhere();
  if (group === "COMPLETED") {
    return { status: { in: [...adminCompletedStatuses] } };
  }
  if (group === "ATTENTION") return adminAttentionWhere();
  return undefined;
}

function adminActiveWhere(): Prisma.JobWhereInput {
  return {
    OR: [
      { status: { in: [...adminActiveStatuses] } },
      {
        status: "FAILED_RETRYABLE",
        type: { not: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE }
      }
    ]
  };
}

function adminAttentionWhere(): Prisma.JobWhereInput {
  return {
    OR: [
      { status: { in: [...adminAttentionStatuses] } },
      {
        status: "FAILED_RETRYABLE",
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE
      }
    ]
  };
}

function adminOperationSummary(job: AdminJob): InternalAdminOperationSummary {
  const errorCode = safeErrorCode(job.errorSummary);
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    ...(job.projectId ? { projectId: job.projectId } : {}),
    ...(job.actorId ? { actorId: job.actorId } : {}),
    type: job.type,
    status: job.status as AdminOperationStatus,
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.provider ? { provider: job.provider } : {}),
    progress: {
      current: job.progressCurrent.toString(),
      ...(job.progressTotal === null
        ? {}
        : { total: job.progressTotal.toString() }),
      ...(job.progressUnit ? { unit: job.progressUnit } : {})
    },
    result: safeResultMetrics(job.resultSummary),
    ...(errorCode ? { errorCode } : {}),
    ...(job.actualCostMicro === null
      ? {}
      : { actualCostMicro: job.actualCostMicro.toString() }),
    ...(job.currency ? { currency: job.currency } : {}),
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt.toISOString(),
    ...(job.queuedAt ? { queuedAt: job.queuedAt.toISOString() } : {}),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {}),
    updatedAt: job.updatedAt.toISOString()
  };
}

function safeResultMetrics(value: unknown): AdminOperationResultMetrics {
  const input = record(value);
  if (!input) return {};
  return compactMetrics({
    processed: firstCount(input, ["processed", "processedCount", "processedUrls", "persistedCount", "published"]),
    succeeded: firstCount(input, ["succeeded", "successCount", "successfulUrls", "imported", "created"]),
    failed: firstCount(input, ["failed", "failedCount", "failedUrls", "missingCount"]),
    found: firstCount(input, ["found", "foundCount"]),
    notFound: firstCount(input, ["notFound", "notFoundCount"]),
    issues: firstCount(input, ["issues", "issueCount"])
  });
}

function compactMetrics(
  value: Record<keyof AdminOperationResultMetrics, number | undefined>
): AdminOperationResultMetrics {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => entry[1] !== undefined)
  );
}

function firstCount(
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const count = safeCount(input[key]);
    if (count !== undefined) return count;
  }
  return undefined;
}

function safeCount(value: unknown): number | undefined {
  const count =
    typeof value === "string" && /^(?:0|[1-9]\d{0,15})$/u.test(value)
      ? Number(value)
      : value;
  return Number.isSafeInteger(count) && Number(count) >= 0
    ? Number(count)
    : undefined;
}

function safeErrorCode(value: unknown): string | undefined {
  const code = record(value)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/u.test(code)
    ? code
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
