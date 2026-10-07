import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalDismissProjectOperationInput,
  InternalWorkspaceExecutionUsage,
  InternalExecutionOverview,
  AdminOperationResultMetrics,
  AdminOperationStatus,
  AdminOperationStatusGroup,
  InternalAdminOperationSearchResult,
  InternalAdminOperationSummary,
  ProjectOperationActivitySummary,
  ProjectOperationDismissal
} from "@seo-platform/contracts";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  Prisma,
  type JobStatus
} from "../generated/prisma/client.js";
import { RankOperationProvenanceService } from "../rank-runs/rank-operation-provenance.service.js";
import type { PlatformAdminOperationQuery } from "./platform-admin-operation-input.js";
import type { RemoteWorkAssignment } from "../worker-nodes/remote-work-assignments.js";

import { ACTIVE_JOB_STATUSES, ACTIVE_IMPORT_STATUSES } from "../jobs/job-capacity.js";
import { STORAGE_RESERVING_UPLOAD_STATUSES } from "../uploads/storage-capacity.js";

const visibleOperationTypes = [
  "FREQUENCY_COLLECTION",
  "MANUAL_RANK_CHECK",
  "AI_ANSWER_COLLECTION",
  "CLUSTERING_RUN",
  "TECHNICAL_CRAWL",
  "KEYWORD_RESEARCH",
  "SEMANTIC_EXPORT"
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const activeOperationStatuses = [
  "PREPARING",
  "QUEUED",
  "WAITING_RATE_LIMIT",
  "RUNNING",
  "CANCEL_REQUESTED",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
] as const;

const dismissibleOperationStatuses = [
  "FAILED_FINAL",
  "ACTION_REQUIRED",
  "EXPIRED"
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
  credentialMode: true,
  scopeSnapshot: true,
  progressCurrent: true,
  progressTotal: true,
  progressUnit: true,
  providerProgressPercent: true,
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
  public constructor(
    private readonly prisma: PrismaService,
    private readonly provenance: RankOperationProvenanceService
  ) {}

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

  public async dismiss(
    input: InternalDismissProjectOperationInput
  ): Promise<ProjectOperationDismissal> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.job.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: { in: [...visibleOperationTypes] },
          OR: [
            { id: input.operationId },
            { technicalCrawl: { is: { id: input.operationId } } },
            { keywordResearchRun: { is: { id: input.operationId } } }
          ]
        },
        select: { id: true, status: true, dismissedAt: true }
      });
      if (!current) throw new NotFoundException("Operation not found");
      if (current.dismissedAt) {
        return {
          operationId: input.operationId,
          dismissedAt: current.dismissedAt.toISOString()
        };
      }
      if (!dismissibleOperationStatuses.includes(
        current.status as (typeof dismissibleOperationStatuses)[number]
      )) {
        throw new ConflictException("Operation is not dismissible");
      }
      const dismissedAt = await databaseClock(
        transaction,
        "Unable to read operation dismissal clock"
      );
      const updated = await transaction.job.updateMany({
        where: {
          id: current.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: { in: [...dismissibleOperationStatuses] },
          dismissedAt: null
        },
        data: {
          dismissedAt,
          dismissedBy: input.actorId,
          // MANUAL_RANK_CHECK is protected by the database-level optimistic
          // version guard even after it reaches a terminal state. Dismissal is
          // a real Job mutation, so advance the canonical version for every
          // operation type instead of bypassing that invariant for rank Jobs.
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException("Operation dismissal conflicted");
      }
      return {
        operationId: input.operationId,
        dismissedAt: dismissedAt.toISOString()
      };
    });
  }

  public async workspaceUsage(workspaceId: string): Promise<InternalWorkspaceExecutionUsage> {
    const [jobs, imports, automations, storage] = await this.prisma.$transaction([
      this.prisma.job.count({ where: { workspaceId, status: { in: [...ACTIVE_JOB_STATUSES] } } }),
      this.prisma.semanticImport.count({ where: { workspaceId, status: { in: [...ACTIVE_IMPORT_STATUSES] } } }),
      this.prisma.automation.count({ where: { workspaceId, enabled: true } }),
      this.prisma.upload.aggregate({ where: { workspaceId, status: { in: [...STORAGE_RESERVING_UPLOAD_STATUSES] } }, _sum: { sizeBytes: true } })
    ]);
    return { workspaceId, concurrentJobs: jobs + imports, automations, storageBytes: (storage._sum.sizeBytes ?? 0n).toString() };
  }

  public async adminList(
    query: PlatformAdminOperationQuery
  ): Promise<InternalAdminOperationSearchResult> {
    // The selector and overview counters describe the complete operation
    // catalog; only the table rows obey the selected type/status filters.
    const baseWhere: Prisma.JobWhereInput = { type: { in: [...visibleOperationTypes] } };
    const listWhere: Prisma.JobWhereInput = query.type
      ? { type: visibleOperationTypes.some(type => type === query.type) ? query.type : { in: [] } }
      : baseWhere;
    const statusWhere = statusGroupWhere(query.statusGroup);
    const filteredWhere: Prisma.JobWhereInput = statusWhere
      ? { AND: [listWhere, statusWhere] }
      : listWhere;
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
          where: baseWhere,
          _count: { _all: true }
        })
      ]);
    const page = jobs.slice(0, query.limit);
    const [presentation, frequency] = await Promise.all([
      this.adminRankPresentation(page),
      this.adminFrequencyPresentation(page)
    ]);
    return {
      data: page.map((job) => adminOperationSummary(
        job,
        presentation.connections.get(job.id),
        presentation.workers.get(job.id),
        frequency.get(job.id)
      )),
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

  public async adminDetail(
    operationId: string
  ): Promise<InternalAdminOperationSummary> {
    const job = await this.prisma.job.findUnique({
      where: { id: operationId },
      select: ADMIN_JOB_SELECT
    });
    if (!job || !visibleOperationTypes.some((type) => type === job.type)) {
      throw new NotFoundException("Operation not found");
    }
    const [presentation, frequency] = await Promise.all([
      this.adminRankPresentation([job]),
      this.adminFrequencyPresentation([job])
    ]);
    return adminOperationSummary(
      job,
      presentation.connections.get(job.id),
      presentation.workers.get(job.id),
      frequency.get(job.id)
    );
  }

  private async adminFrequencyPresentation(jobs: readonly AdminJob[]): Promise<ReadonlyMap<string, {
    readonly mode?: "FREQUENCY" | "SEASONALITY";
    readonly failureCode?: "PROVIDER_LOW_BALANCE";
  }>> {
    const ids = jobs.filter((job) => job.type === "FREQUENCY_COLLECTION").map((job) => job.id);
    if (ids.length === 0) return new Map();
    // Project only the mode, not the potentially large keyword input snapshot.
    // The item lookup runs only for jobs whose aggregate error hides a failure.
    const rows = await this.prisma.$queryRaw<readonly {
      readonly jobId: string;
      readonly mode: string | null;
      readonly failureCode: string | null;
    }[]>`
      SELECT job.id::text AS "jobId",
             job.input_snapshot->>'mode' AS mode,
             CASE WHEN job.error_summary->>'code' = 'ITEMS_FAILED' THEN (
               SELECT item.error->>'code'
               FROM public.job_items AS item
               WHERE item.job_id = job.id
                 AND item.status = 'FAILED_FINAL'
                 AND item.error->>'code' = 'PROVIDER_LOW_BALANCE'
               LIMIT 1
             ) END AS "failureCode"
      FROM public.jobs AS job
      WHERE job.id = ANY(${ids}::uuid[])
    `;
    return new Map(rows.map((row) => [row.jobId, {
      ...(row.mode === "FREQUENCY" || row.mode === "SEASONALITY" ? { mode: row.mode } : {}),
      ...(row.failureCode === "PROVIDER_LOW_BALANCE" ? { failureCode: row.failureCode } : {})
    }]));
  }

  private async adminRankPresentation(jobs: readonly AdminJob[]): Promise<{
    readonly connections: ReadonlyMap<string, {
      readonly label: string;
      readonly displayHint?: string;
    }>;
    readonly workers: ReadonlyMap<string, readonly {
      readonly name: string;
      readonly activeTasks: number;
      readonly nodeId?: string;
      readonly status?: "ONLINE" | "OFFLINE" | "DRAINING" | "DISABLED" | "MAIN";
      readonly assignedOperations?: number;
    }[]>;
  }> {
    const providerJobs = jobs.filter((job) =>
      (job.credentialMode === "BYOK_API_KEY" ||
        job.credentialMode === "PLATFORM_PAID") &&
      (job.provider === "XMLSTOCK" || job.provider === "ARSENKIN")
    );
    const rankJobs = providerJobs.filter((job) => job.type === "MANUAL_RANK_CHECK");
    const [connections, assignments,genericAssignments] = await Promise.all([
      this.provenance.selectedForJobs(providerJobs.map((job) => ({
        id: job.id,
        workspaceId: job.workspaceId,
        type: job.type,
        credentialMode: job.credentialMode as "BYOK_API_KEY" | "PLATFORM_PAID",
        provider: job.provider,
        ...(typeof record(job.scopeSnapshot)?.credentialId === "string" &&
          UUID_PATTERN.test(record(job.scopeSnapshot)?.credentialId as string)
          ? { credentialId: record(job.scopeSnapshot)?.credentialId as string }
          : {})
      }))),
      rankJobs.length === 0 ? Promise.resolve([]) : this.prisma.$queryRaw<readonly {
        readonly nodeId: string;
        readonly jobId: string;
        readonly activeTasks: bigint;
      }[]>`SELECT "nodeId", "jobId", "activeTasks"
          FROM public.list_remote_worker_rank_assignments(1000)`,
      jobs.length===0 ? Promise.resolve([]) : this.prisma.$queryRaw<readonly RemoteWorkAssignment[]>`SELECT * FROM public.list_remote_work_assignments(1000,${jobs.map(job=>job.id)}::uuid[])`
    ]);
    const relevantIds = new Set(jobs.map((job) => job.id));
    const rankIds=new Set(rankJobs.map(job=>job.id));
    const allAssignments=[...assignments.filter(row=>rankIds.has(row.jobId)),...genericAssignments];
    const jobsWithActiveWork = new Set(allAssignments
      .filter((assignment) => assignment.activeTasks > 0n)
      .map((assignment) => assignment.jobId));
    const visibleAssignments = allAssignments.filter((assignment) =>
      assignment.activeTasks > 0n || !jobsWithActiveWork.has(assignment.jobId)
    );
    const nodeIds = [...new Set(visibleAssignments.flatMap((item) =>
      item.nodeId === "main" || !relevantIds.has(item.jobId)
        ? [] : [item.nodeId]
    ))];
    const [nodes,assignedCounts] = await Promise.all([
      nodeIds.length === 0 ? Promise.resolve([]) : this.prisma.executionWorkerNode.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, name: true, enabled: true, draining: true, deletedAt: true, lastHeartbeatAt: true }
      }),
      nodeIds.length === 0 ? Promise.resolve([]) : this.prisma.$queryRaw<readonly {nodeId:string;assignedOperations:bigint}[]>`
        SELECT assigned.node_id AS "nodeId",COUNT(DISTINCT assigned.job_id) AS "assignedOperations"
        FROM (
          SELECT assignment.node_id,assignment.job_id FROM public.rank_job_worker_assignments assignment
          JOIN public.jobs job ON job.id=assignment.job_id AND job.status='RUNNING'
          WHERE assignment.node_id=ANY(${nodeIds}::uuid[])
          UNION ALL
          SELECT assignment.node_id,assignment.job_id FROM public.remote_operation_assignments assignment
          JOIN public.jobs job ON job.id=assignment.job_id AND job.status='RUNNING'
          WHERE assignment.node_id=ANY(${nodeIds}::uuid[]) AND assignment.job_id IS NOT NULL
        ) assigned GROUP BY assigned.node_id`
    ]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const countById = new Map(assignedCounts.map((row) => [row.nodeId, Number(row.assignedOperations)]));
    const workersByJob = new Map<string, Map<string, {
      name: string;
      activeTasks: number;
      nodeId?: string;
      status: "ONLINE" | "OFFLINE" | "DRAINING" | "DISABLED" | "MAIN";
      assignedOperations: number;
    }>>();
    for (const assignment of visibleAssignments) {
      if (!relevantIds.has(assignment.jobId)) continue;
      const node = nodeById.get(assignment.nodeId);
      const name = assignment.nodeId === "main" ? "Основной сервер" : node?.name ?? "Удалённый воркер";
      const status = assignment.nodeId === "main" ? "MAIN" as const
        : !node || node.deletedAt || !node.lastHeartbeatAt || Date.now()-node.lastHeartbeatAt.getTime()>30_000 ? "OFFLINE" as const
        : !node.enabled ? "DISABLED" as const : node.draining ? "DRAINING" as const : "ONLINE" as const;
      const byNode = workersByJob.get(assignment.jobId) ?? new Map();
      const existing = byNode.get(assignment.nodeId);
      if (existing) existing.activeTasks += Number(assignment.activeTasks);
      else byNode.set(assignment.nodeId, {
        name, activeTasks: Number(assignment.activeTasks),status,
        ...(assignment.nodeId === "main" ? {} : {nodeId:assignment.nodeId}),
        assignedOperations:assignment.nodeId === "main" ? 1 : countById.get(assignment.nodeId) ?? 1
      });
      workersByJob.set(assignment.jobId, byNode);
    }
    const workers = new Map([...workersByJob].map(([jobId, byNode]) =>
      [jobId, [...byNode.entries()]
        .sort(([leftId, left], [rightId, right]) =>
          (leftId === "main" ? -1 : rightId === "main" ? 1 : 0) ||
          left.name.localeCompare(right.name, "ru") ||
          leftId.localeCompare(rightId)
        )
        .map(([, value]) => value)] as const
    ));
    for (const job of jobs) {
      if (job.type !== "MANUAL_RANK_CHECK" && job.status === "RUNNING" && !workers.has(job.id)) {
        workers.set(job.id, [{ name: "Основной сервер", activeTasks: 0, status: "MAIN", assignedOperations: 1 }]);
      }
    }
    return { connections, workers };
  }

  public async overview(): Promise<InternalExecutionOverview> {
    const now = Date.now();
    const [active, queued, attention, failed24h, completed30d, groups] = await Promise.all([
      this.prisma.job.count({ where: { type: { in: [...visibleOperationTypes] }, status: { in: [...ACTIVE_JOB_STATUSES] } } }),
      this.prisma.job.count({ where: { type: { in: [...visibleOperationTypes] }, status: "QUEUED" } }),
      this.prisma.job.count({ where: { type: { in: [...visibleOperationTypes] }, status: "ACTION_REQUIRED" } }),
      this.prisma.job.count({ where: { type: { in: [...visibleOperationTypes] }, status: "FAILED_FINAL", updatedAt: { gte: new Date(now - 86_400_000) } } }),
      this.prisma.job.count({ where: { type: { in: [...visibleOperationTypes] }, status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] }, finishedAt: { gte: new Date(now - 30 * 86_400_000) } } }),
      this.prisma.job.groupBy({ by: ["type"], where: { type: { in: [...visibleOperationTypes] }, createdAt: { gte: new Date(now - 30 * 86_400_000) } }, _count: { _all: true } })
    ]);
    return { active, queued, attention, failed24h, completed30d, byType30d: groups.map(row => ({ type: row.type, count: row._count._all })).sort((a, b) => b.count - a.count).slice(0, 50) };
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
      { status: "FAILED_RETRYABLE" }
    ]
  };
}

function adminAttentionWhere(): Prisma.JobWhereInput {
  return { status: { in: [...adminAttentionStatuses] } };
}

function adminOperationSummary(
  job: AdminJob,
  connection?: { readonly label: string; readonly displayHint?: string },
  workers?: readonly { readonly name: string; readonly activeTasks: number;
    readonly nodeId?: string; readonly status?: "ONLINE" | "OFFLINE" | "DRAINING" | "DISABLED" | "MAIN";
    readonly assignedOperations?: number }[],
  frequency?: { readonly mode?: "FREQUENCY" | "SEASONALITY"; readonly failureCode?: "PROVIDER_LOW_BALANCE" }
): InternalAdminOperationSummary {
  const errorCode = frequency?.failureCode ?? safeErrorCode(job.errorSummary);
  const scope = record(job.scopeSnapshot);
  const searchSource = scope?.searchSource === "LIVE" || scope?.searchSource === "SEARCH_API"
    ? scope.searchSource : undefined;
  const searchEngine = scope?.searchEngine === "YANDEX" ||
    scope?.searchEngine === "GOOGLE" ? scope.searchEngine :
    (job.type === "FREQUENCY_COLLECTION" || job.type === "KEYWORD_RESEARCH") &&
      (job.provider === "XMLSTOCK" || job.provider === "ARSENKIN")
      ? "YANDEX" : undefined;
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    ...(job.projectId ? { projectId: job.projectId } : {}),
    ...(job.actorId ? { actorId: job.actorId } : {}),
    type: job.type,
    status: job.status as AdminOperationStatus,
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.provider ? { provider: job.provider } : {}),
    ...(searchEngine ? { searchEngine } : {}),
    ...(searchSource ? { searchSource } : {}),
    ...(scope?.yandexLiveMode === "TURBO" ? { yandexLiveMode: "TURBO" as const } : {}),
    ...(frequency?.mode ? { frequencyMode: frequency.mode } : {}),
    ...(connection ? { connection } : {}),
    ...(workers?.length ? { workers } : {}),
    progress: {
      current: job.progressCurrent.toString(),
      ...(job.progressTotal === null
        ? {}
        : { total: job.progressTotal.toString() }),
      ...(job.progressUnit ? { unit: job.progressUnit } : {})
    },
    ...(job.type === "AI_ANSWER_COLLECTION" &&
      job.stage === "provider_poll" &&
      ["RUNNING", "RETRY_SCHEDULED", "FAILED_RETRYABLE"].includes(job.status) &&
      typeof job.providerProgressPercent === "number"
      ? { providerProgressPercent: job.providerProgressPercent }
      : {}),
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
