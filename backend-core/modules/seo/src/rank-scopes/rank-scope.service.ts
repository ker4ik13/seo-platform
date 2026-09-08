import { Injectable, NotFoundException } from "@nestjs/common";
import {
  trackingDepths,
  type InternalRankEstimateScope,
  type InternalRankEstimateScopeQuery,
  type TrackingContextConfigurationInput,
  type TrackingDepth
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  inspectRankScopeBounds,
  withRankScopeReadPlan,
  readRankScopeAssignments,
  rankScopeIsMaterializable
} from "./rank-scope-bounds.js";
import { semanticRankScopeHash } from "./rank-scope-hash.js";
import { trackingContextIncludesUntracked } from "../tracking-contexts/tracking-context-launch-profile.js";

const CONFIGURATION_HASH_PATTERN = /^[0-9a-f]{64}$/u;

const CONTEXT_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  status: true,
  version: true,
  launchProfile: true,
  configurations: {
    orderBy: { configurationVersion: "desc" as const },
    take: 1,
    select: {
      configurationVersion: true,
      configurationHash: true,
      searchEngine: true,
      countryCode: true,
      regionCode: true,
      regionLabel: true,
      language: true,
      device: true,
      depth: true,
      domainMatchMode: true,
      domainMatchValue: true,
      safeSearch: true
    }
  }
} satisfies Prisma.TrackingContextSelect;

type ContextRecord = Prisma.TrackingContextGetPayload<{
  select: typeof CONTEXT_SELECT;
}>;
@Injectable()
export class RankScopeService {
  public constructor(private readonly prisma: PrismaService) {}

  public async calculate(
    input: InternalRankEstimateScopeQuery
  ): Promise<InternalRankEstimateScope> {
    return this.prisma.$transaction(
      async (transaction) => {
        const context = await transaction.trackingContext.findFirst({
          where: {
            id: input.trackingContextId,
            workspaceId: input.workspaceId,
            projectId: input.projectId
          },
          select: CONTEXT_SELECT
        });
        if (!context) {
          throw new NotFoundException("Tracking context not found");
        }
        const configuration = currentConfiguration(context);
        const includeUntracked = trackingContextIncludesUntracked(
          context.launchProfile
        );
        const { bounds, materializable, assignments } = await withRankScopeReadPlan(transaction, {
          workspaceId: input.workspaceId, projectId: input.projectId, contextId: context.id, includeUntracked
        }, async () => {
        const bounds = await inspectRankScopeBounds(transaction, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          contextId: context.id,
          includeUntracked
        });
        const materializable = rankScopeIsMaterializable(bounds);
        const assignments = materializable
          ? await readRankScopeAssignments(transaction, { workspaceId: input.workspaceId, projectId: input.projectId, contextId: context.id, includeUntracked })
          : [];
          return { bounds, materializable, assignments };
        });
        if (
          materializable &&
          assignments.length !== bounds.assignmentCount
        ) {
          throw new Error("Rank execution scope count is inconsistent");
        }
        const keywordCount = bounds.assignmentCount;
        return {
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          trackingContextId: context.id,
          contextStatus: context.status,
          contextVersion: context.version,
          configurationVersion: configuration.configurationVersion,
          configurationHash: configuration.configurationHash,
          configuration: safeConfiguration(configuration),
          keywordCount: String(keywordCount),
          contextCount: "1",
          pairCount: String(keywordCount),
          semanticScopeHash: !materializable
            ? { availability: "UNAVAILABLE" }
            : {
                availability: "AVAILABLE",
                algorithm: "SHA_256",
                value: semanticRankScopeHash(
                  context,
                  configuration,
                  assignments
                )
              },
          calculatedAt: new Date().toISOString()
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 }
    );
  }
}

function currentConfiguration(context: ContextRecord) {
  const configuration = context.configurations[0];
  if (!configuration) {
    throw new Error("Tracking context has no configuration version");
  }
  if (
    !Number.isSafeInteger(configuration.configurationVersion) ||
    configuration.configurationVersion < 1 ||
    !CONFIGURATION_HASH_PATTERN.test(configuration.configurationHash)
  ) {
    throw new Error("Tracking context configuration is invalid");
  }
  return configuration;
}

function safeConfiguration(
  configuration: ReturnType<typeof currentConfiguration>
): TrackingContextConfigurationInput {
  const domainMatchRule =
    configuration.domainMatchMode === "SPECIFIC_URL" ||
    configuration.domainMatchMode === "URL_PREFIX"
      ? {
          mode: configuration.domainMatchMode,
          value: requiredDomainValue(configuration.domainMatchValue)
        }
      : { mode: configuration.domainMatchMode };
  return {
    searchEngine: configuration.searchEngine,
    countryCode: configuration.countryCode,
    ...(configuration.regionCode
      ? { regionCode: configuration.regionCode }
      : {}),
    ...(configuration.regionLabel
      ? { regionLabel: configuration.regionLabel }
      : {}),
    language: configuration.language,
    device: configuration.device,
    depth: trackingDepth(configuration.depth),
    domainMatchRule,
    safeSearch: configuration.safeSearch
  };
}

function trackingDepth(value: number): TrackingDepth {
  if (!trackingDepths.some((depth) => depth === value)) {
    throw new Error("Tracking context depth is invalid");
  }
  return value as TrackingDepth;
}

function requiredDomainValue(value: string | null): string {
  if (!value) {
    throw new Error("Tracking context domain match rule is incomplete");
  }
  return value;
}
