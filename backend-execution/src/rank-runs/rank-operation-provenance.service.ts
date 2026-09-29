import { Injectable, NotFoundException } from "@nestjs/common";
import type { RankOperationSourceUsage } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { storedXmlStockOperationUsage } from "../integrations/xmlstock-pricing.js";

interface AdminProviderJobIdentity {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly credentialMode: "BYOK_API_KEY" | "PLATFORM_PAID";
  readonly provider: string | null;
  readonly credentialId?: string;
}

interface ConnectionDisplay {
  readonly label: string;
  readonly displayHint?: string;
}

@Injectable()
export class RankOperationProvenanceService {
  public constructor(private readonly prisma: PrismaService) {}

  public async selectedForJobs(
    jobs: readonly AdminProviderJobIdentity[]
  ): Promise<ReadonlyMap<string, ConnectionDisplay>> {
    const providerJobs = jobs.filter((job) =>
      job.provider === "XMLSTOCK" || job.provider === "ARSENKIN"
    );
    if (providerJobs.length === 0) return new Map();
    const rankJobs = providerJobs.filter((job) =>
      job.type === "MANUAL_RANK_CHECK" &&
      job.credentialMode === "BYOK_API_KEY" && !job.credentialId
    );
    const runs = rankJobs.length === 0 ? [] : await this.prisma.rankJobRun.findMany({
      where: { jobId: { in: rankJobs.map((job) => job.id) } },
      select: {
        jobId: true,
        workspaceId: true,
        estimate: { select: { credentialId: true } }
      }
    });
    const credentialIds = [...new Set([
      ...providerJobs.flatMap((job) => job.credentialMode === "BYOK_API_KEY" && job.credentialId
        ? [job.credentialId] : []),
      ...runs.flatMap((run) => run.estimate.credentialId
        ? [run.estimate.credentialId] : [])
    ])];
    const credentials = credentialIds.length === 0 ? [] :
      await this.prisma.integrationCredential.findMany({
      where: {
        id: { in: credentialIds }
      },
      select: { id: true, workspaceId: true, label: true, displayHint: true }
    });
    const credentialById = new Map(credentials.map((item) => [item.id, item]));
    const runByJob = new Map(runs.map((run) => [run.jobId, run]));
    const result = new Map<string, ConnectionDisplay>();
    for (const job of providerJobs) {
      if (job.credentialMode === "PLATFORM_PAID") {
        result.set(job.id, { label: "Системный ключ" });
        continue;
      }
      const run = runByJob.get(job.id);
      const credentialId = job.credentialId ?? run?.estimate.credentialId;
      const credential = credentialId
        ? credentialById.get(credentialId)
        : undefined;
      if ((!run || run.workspaceId === job.workspaceId) &&
        credential?.workspaceId === job.workspaceId) {
        result.set(job.id, connectionDisplay(credential));
      }
    }
    return result;
  }

  public async sourcesForJob(input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<readonly RankOperationSourceUsage[]> {
    const job = await this.prisma.job.findFirst({
      where: {
        id: input.jobId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        type: "MANUAL_RANK_CHECK"
      },
      select: {
        provider: true,
        credentialMode: true,
        scopeSnapshot: true,
        rankRun: {
          select: { estimate: { select: { credentialId: true } } }
        }
      }
    });
    if (!job) throw new NotFoundException("Rank Job not found");
    return rankSourcesFromStoredJob(this.prisma, input, job);
  }
}

export async function rankSourcesFromStoredJob(
  prisma: PrismaService,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly jobId: string;
  },
  job: {
    readonly provider: string | null;
    readonly credentialMode: string;
    readonly scopeSnapshot: unknown;
    readonly rankRun: {
      readonly estimate: { readonly credentialId: string | null };
    } | null;
  }
): Promise<readonly RankOperationSourceUsage[]> {
  const grouped = await prisma.rankConnectorExecution.groupBy({
    by: ["credentialId", "provider"],
    where: {
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      projectId: input.projectId
    },
    _sum: { submitAttemptCount: true, pollAttemptCount: true }
  });
  if (grouped.length > 16) {
    throw new Error("Rank Job has too many connection sources");
  }
  const scope = record(job.scopeSnapshot);
  const usage = storedXmlStockOperationUsage(record(scope?.providerUsage));
  const searchApi = usage?.product === "YANDEX_SEARCH_API" ||
    scope?.searchSource === "SEARCH_API";
  const requestCount = (group: (typeof grouped)[number]): bigint => {
    const submit = BigInt(group._sum.submitAttemptCount ?? 0);
    const poll = BigInt(group._sum.pollAttemptCount ?? 0);
    return group.provider === "XMLSTOCK"
      ? searchApi ? submit : poll
      : submit + poll;
  };
  if (job.credentialMode === "PLATFORM_PAID") {
    const provider = safeProvider(job.provider);
    return provider ? [{
      provider,
      label: "Системный ключ",
      requestCount: grouped.reduce((total, group) => total +
        (group.provider === provider ? requestCount(group) : 0n), 0n).toString(),
      selected: true
    }] : [];
  }
  const selectedId = job.rankRun?.estimate.credentialId;
  const ids = [...new Set([
    ...(selectedId ? [selectedId] : []),
    ...grouped.map((group) => group.credentialId)
  ])];
  const credentials = ids.length === 0 ? [] :
    await prisma.integrationCredential.findMany({
      where: { id: { in: ids }, workspaceId: input.workspaceId },
      select: {
        id: true,
        label: true,
        displayHint: true,
        provider: true
      }
    });
  const credentialById = new Map(credentials.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const credential = credentialById.get(id);
    const provider = safeProvider(credential?.provider ??
      grouped.find((group) => group.credentialId === id)?.provider);
    if (!provider) return [];
    const display = credential
      ? connectionDisplay(credential)
      : { label: "Удалённое подключение" };
    return [{
      provider,
      ...display,
      requestCount: grouped
        .filter((group) => group.credentialId === id)
        .reduce((total, group) => total + requestCount(group), 0n)
        .toString(),
      selected: id === selectedId
    }];
  });
}

function connectionDisplay(value: {
  readonly label: string;
  readonly displayHint: string | null;
}): ConnectionDisplay {
  return {
    label: value.label,
    ...(value.displayHint ? { displayHint: value.displayHint } : {})
  };
}

function safeProvider(value: unknown): "XMLSTOCK" | "ARSENKIN" | undefined {
  return value === "XMLSTOCK" || value === "ARSENKIN" ? value : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
