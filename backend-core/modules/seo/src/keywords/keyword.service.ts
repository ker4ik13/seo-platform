import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  InternalCreateSemanticKeywordInput,
  InternalDeleteSemanticKeywordInput,
  InternalSemanticKeywordBulkCreateInput,
  InternalSemanticKeywordBulkInput,
  InternalSemanticKeywordCleaningInput,
  InternalUpdateSemanticKeywordInput,
  KeywordListQuery,
  ProjectPositionSummary,
  SemanticKeywordBulkResult,
  SemanticKeywordBulkCreateResult,
  SemanticKeywordCreateOutcome,
  SemanticKeywordCleaningPreview,
  SemanticKeywordCleaningPreviewChange,
  SemanticKeywordCleaningResult,
  SemanticKeywordIntent,
  SemanticKeywordPositionHistoryProvider,
  SemanticKeywordListItem,
  SemanticKeywordListFrequencyValue,
  SemanticKeywordListPosition,
  SemanticKeywordInsights,
  SemanticKeywordSort,
  SemanticFrequencyDevice,
  SemanticFrequencyQualityFlag,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertStoredKeywordCapacity,
  lockStoredKeywordCapacity
} from "../internal/semantic-capacity.js";
import {
  lockSemanticKeywordWrites,
  SemanticVersionService,
  type SemanticKeywordVersionState,
  type SemanticVersionIdentity
} from "../semantic-versions/semantic-version.service.js";
import { normalizeKeywordText } from "./keyword-normalization.js";
import { cleanKeywordText } from "./keyword-cleaning.js";
import { normalizePageUrl } from "../pages/page-url.js";
import { ensureKeywordSystemGroupIds } from "../keyword-groups/semantic-system-groups.js";
import {
  projectSiteResults,
  rankHistorySearchSource
} from "../rank-results/rank-serp-projection.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface KeywordCursor {
  readonly version: 2;
  readonly id: string;
  readonly sort: SemanticKeywordSort;
  readonly sortValue: string | number;
  readonly filterHash: string;
}

const KEYWORD_INCLUDE = {
  memberships: {
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: {
      group: {
        select: { id: true, path: true, name: true, systemKind: true }
      }
    }
  },
  tags: {
    orderBy: { createdAt: "asc" as const },
    select: {
      tag: {
        select: { id: true, name: true }
      }
    }
  },
  typedCustomValues: {
    where: { column: { status: "ACTIVE" as const } },
    orderBy: { columnId: "asc" as const },
    take: 500,
    include: { column: { select: { type: true } } }
  }
} satisfies Prisma.KeywordInclude;

type KeywordAggregate = Prisma.KeywordGetPayload<{
  include: typeof KEYWORD_INCLUDE;
}>;

type RankSearchEngine = SemanticKeywordListPosition["searchEngine"];

interface PreviousFoundPositionAnchor {
  readonly keywordId: string;
  readonly searchEngine: RankSearchEngine;
  readonly observedAt: Date;
  readonly snapshotId: string;
}

interface PreviousFoundPositionRow {
  readonly keywordId: string;
  readonly searchEngine: RankSearchEngine;
  readonly observedAt: Date;
  readonly snapshotId: string;
  readonly previousPosition: number;
}

@Injectable()
export class KeywordService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly semanticVersions: SemanticVersionService
  ) {}

  public async positionSummary(
    workspaceId: string,
    projectId: string
  ): Promise<ProjectPositionSummary> {
    const [keywords, ranks] = await Promise.all([
      this.prisma.keyword.findMany({
        where: { workspaceId, projectId, status: "ACTIVE" },
        select: { id: true }
      }),
      this.prisma.currentRank.findMany({
        where: {
          workspaceId,
          projectId,
          found: true,
          position: { not: null }
        },
        orderBy: [{ observedAt: "desc" }, { keywordId: "asc" }],
        select: { keywordId: true, position: true }
      })
    ]);
    const activeKeywordIds = new Set(keywords.map(({ id }) => id));
    const positions = new Map<string, number>();
    for (const rank of ranks) {
      if (
        rank.position !== null &&
        activeKeywordIds.has(rank.keywordId) &&
        !positions.has(rank.keywordId)
      ) {
        positions.set(rank.keywordId, rank.position);
      }
    }
    if (positions.size === 0) return { positionedKeywordCount: 0 };
    const average =
      [...positions.values()].reduce((sum, position) => sum + position, 0) /
      positions.size;
    return {
      positionedKeywordCount: positions.size,
      averagePosition: Math.round(average * 10) / 10
    };
  }

  public async list(
    workspaceId: string,
    projectId: string,
    query: KeywordListQuery,
    requestId: string
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const search = normalizeKeywordText(query.search);
    const tag = normalizeTagName(query.tag ?? "");
    const sort = query.sort ?? "CREATED_DESC";
    const selectedGroup = query.groupId
      ? await this.prisma.keywordGroup.findFirst({
          where: {
            id: query.groupId,
            workspaceId,
            projectId,
            status: "ACTIVE"
          },
          select: { systemKind: true }
        })
      : undefined;
    const selectedGroupIds = query.groupIds?.length
      ? [...query.groupIds]
      : query.groupId
        ? [query.groupId]
        : [];
    const keywordStatus =
      selectedGroup?.systemKind === "TRASH" ? "DELETED" : "ACTIVE";
    const filterHash = keywordFilterHash(query, search, tag);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, sort, filterHash)
      : undefined;
    const baseWhere: Prisma.KeywordWhereInput = {
      workspaceId,
      projectId,
      status: keywordStatus,
      ...(search
        ? {
            textNormalized: {
              contains: search
            }
          }
        : {}),
      ...(tag
        ? {
            tags: {
              some: {
                projectId,
                tag: {
                  workspaceId,
                  projectId,
                  status: "ACTIVE",
                  normalizedName: { contains: tag }
                }
              }
            }
          }
        : {}),
      ...(query.intent ? { intent: query.intent } : {}),
      ...(query.isFavorite === undefined
        ? {}
        : { isFavorite: query.isFavorite }),
      ...(query.priorityMin === undefined &&
      query.priorityMax === undefined
        ? {}
        : {
            priority: {
              ...(query.priorityMin === undefined
                ? {}
                : { gte: query.priorityMin }),
              ...(query.priorityMax === undefined
                ? {}
                : { lte: query.priorityMax })
            }
          }),
      ...(selectedGroupIds.length > 0
        ? {
            memberships: {
              some: {
                projectId,
                groupId:
                  selectedGroupIds.length === 1
                    ? selectedGroupIds[0]!
                    : { in: selectedGroupIds }
              }
            }
          }
        : {}),
      ...(query.clusterId ? { clusterId: query.clusterId } : {}),
      ...(query.isTracked === undefined
        ? {}
        : {
            trackingAssignments: query.isTracked
              ? {
                  some: {
                    workspaceId,
                    projectId,
                    removedAt: null,
                    context: { status: "ACTIVE" }
                  }
                }
              : {
                  none: {
                    workspaceId,
                    projectId,
                    removedAt: null,
                    context: { status: "ACTIVE" }
                  }
                }
          })
    };
    let externalSortValueById = new Map<string, string>();
    let rows: KeywordAggregate[];
    let totalApprox: number | undefined;
    if (isExternalKeywordSort(sort)) {
      const [externalPage, count] = await Promise.all([
        isMetricKeywordSort(sort)
          ? metricSortedKeywordPage(
              this.prisma,
              workspaceId,
              projectId,
              query,
              search,
              tag,
              sort,
              cursor,
              keywordStatus
            )
          : tagSortedKeywordPage(
              this.prisma,
              workspaceId,
              projectId,
              query,
              search,
              tag,
              sort,
              cursor,
              keywordStatus
            ),
        cursor
          ? Promise.resolve(undefined)
          : this.prisma.keyword.count({ where: baseWhere })
      ]);
      const aggregates: KeywordAggregate[] = externalPage.ids.length === 0
        ? []
        : await this.prisma.keyword.findMany({
            where: { ...baseWhere, id: { in: [...externalPage.ids] } },
            include: KEYWORD_INCLUDE
          });
      const aggregateById = new Map(aggregates.map((row) => [row.id, row]));
      rows = externalPage.ids.flatMap((id) => {
        const row = aggregateById.get(id);
        return row ? [row] : [];
      });
      externalSortValueById = externalPage.sortValueById;
      totalApprox = count;
    } else {
      const where: Prisma.KeywordWhereInput = {
        ...baseWhere,
        ...(cursor ? cursorWhere(cursor) : {})
      };
      [rows, totalApprox] = await Promise.all([
        this.prisma.keyword.findMany({
          where,
          orderBy: keywordOrderBy(sort),
          take: query.limit + 1,
          include: KEYWORD_INCLUDE
        }),
        cursor
          ? Promise.resolve(undefined)
          : this.prisma.keyword.count({ where: baseWhere })
      ]);
    }
    const hasNext = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const pageIds = [
      ...new Set(
        pageRows.flatMap(({ targetPageId }) =>
          targetPageId ? [targetPageId] : []
        )
      )
    ];
    const keywordIds = pageRows.map(({ id }) => id);
    const clusterIds = [
      ...new Set(
        pageRows.flatMap(({ clusterId }) => (clusterId ? [clusterId] : []))
      )
    ];
    const [
      pages,
      activeTrackingAssignments,
      clusters,
      frequencySnapshots,
      currentRanks,
      selectedGroupMemberships
    ] = await Promise.all([
      pageIds.length === 0
        ? Promise.resolve([])
        : this.prisma.page.findMany({
            where: {
              workspaceId,
              projectId,
              id: { in: pageIds },
              status: "ACTIVE"
            },
            select: { id: true, url: true }
          }),
      keywordIds.length === 0
        ? Promise.resolve([])
        : this.prisma.trackingContextKeywordAssignment.findMany({
            where: {
              workspaceId,
              projectId,
              keywordId: { in: keywordIds },
              removedAt: null,
              context: { status: "ACTIVE" }
            },
            select: { keywordId: true },
            distinct: ["keywordId"]
          }),
      clusterIds.length === 0
        ? Promise.resolve([])
        : this.prisma.cluster.findMany({
            where: {
              workspaceId,
              projectId,
              id: { in: clusterIds },
              status: "ACTIVE"
            },
            select: { id: true, name: true }
          }),
      keywordIds.length === 0
        ? Promise.resolve([])
        : this.prisma.frequencySnapshot.findMany({
            where: {
              workspaceId,
              projectId,
              keywordId: { in: keywordIds },
            },
            orderBy: [
              { keywordId: "asc" },
              { observedAt: "desc" },
              { id: "desc" }
            ],
            distinct: ["keywordId", "type"],
            select: {
              keywordId: true,
              type: true,
              value: true,
              regionCode: true,
              device: true,
              provider: true,
              observedAt: true
            }
          }),
      keywordIds.length === 0
        ? Promise.resolve([])
        : this.prisma.currentRank.findMany({
            where: { workspaceId, projectId, keywordId: { in: keywordIds } },
            orderBy: [
              { observedAt: "desc" },
              { snapshotId: "desc" },
              { keywordId: "asc" },
              { trackingContextId: "desc" }
            ],
            select: {
              keywordId: true,
              trackingContextId: true,
              configurationVersion: true,
              found: true,
              position: true,
              previousPosition: true,
              rankingUrl: true,
              observedAt: true,
              snapshotId: true
            }
          }),
      keywordIds.length === 0 || selectedGroupIds.length === 0
        ? Promise.resolve([])
        : this.prisma.keywordGroupMembership.findMany({
            where: {
              projectId,
              keywordId: { in: keywordIds },
              groupId: { in: selectedGroupIds },
              group: { workspaceId, projectId, status: "ACTIVE" }
            },
            orderBy: [{ createdAt: "asc" }, { groupId: "asc" }],
            select: {
              keywordId: true,
              group: { select: { id: true, path: true, name: true } }
            }
          })
    ]);
    const rankConfigurations = currentRanks.length === 0
      ? []
      : await this.prisma.trackingContextVersion.findMany({
          where: {
            workspaceId,
            projectId,
            OR: currentRanks.map((rank) => ({
              contextId: rank.trackingContextId,
              configurationVersion: rank.configurationVersion
            }))
          },
          select: {
            contextId: true,
            configurationVersion: true,
            searchEngine: true
          }
        });
    const pageUrlById = new Map(pages.map(({ id, url }) => [id, url]));
    const trackedKeywordIds = new Set(
      activeTrackingAssignments.map(({ keywordId }) => keywordId)
    );
    const clusterNameById = new Map(
      clusters.map(({ id, name }) => [id, name])
    );
    const selectedGroupByKeywordId = new Map<
      string,
      (typeof selectedGroupMemberships)[number]["group"]
    >();
    for (const membership of selectedGroupMemberships) {
      if (!selectedGroupByKeywordId.has(membership.keywordId)) {
        selectedGroupByKeywordId.set(membership.keywordId, membership.group);
      }
    }
    const frequenciesByKeywordId = new Map<
      string,
      SemanticKeywordListFrequencyValue[]
    >();
    for (const snapshot of frequencySnapshots) {
      const frequencies = frequenciesByKeywordId.get(snapshot.keywordId) ?? [];
      frequencies.push({
        type: snapshot.type as SemanticKeywordListFrequencyValue["type"],
        ...(snapshot.value === null
          ? {}
          : { value: snapshot.value.toString() }),
        regionCode: snapshot.regionCode,
        device: frequencyDevice(snapshot.device),
        provider: snapshot.provider,
        observedAt: snapshot.observedAt.toISOString()
      });
      frequenciesByKeywordId.set(snapshot.keywordId, frequencies);
    }
    const configurationById = new Map(
      rankConfigurations.map((configuration) => [
        `${configuration.contextId}:${configuration.configurationVersion}`,
        configuration
      ])
    );
    const latestRankByKeywordEngine = new Map<
      string,
      Readonly<{
        rank: (typeof currentRanks)[number];
        searchEngine: RankSearchEngine;
      }>
    >();
    for (const rank of currentRanks) {
      const configuration = configurationById.get(
        `${rank.trackingContextId}:${rank.configurationVersion}`
      );
      if (!configuration) continue;
      const searchEngine = configuration.searchEngine as RankSearchEngine;
      const key = `${rank.keywordId}:${searchEngine}`;
      if (!latestRankByKeywordEngine.has(key)) {
        latestRankByKeywordEngine.set(key, { rank, searchEngine });
      }
    }
    const previousPositions = await previousFoundPositions(
      this.prisma,
      workspaceId,
      projectId,
      [...latestRankByKeywordEngine.values()].map(({ rank, searchEngine }) => ({
        keywordId: rank.keywordId,
        searchEngine,
        observedAt: rank.observedAt,
        snapshotId: rank.snapshotId
      }))
    );
    const latestRankSnapshotIds = [...latestRankByKeywordEngine.values()].map(
      ({ rank }) => rank.snapshotId
    );
    const currentSerpSnapshots = latestRankSnapshotIds.length === 0
      ? []
      : await this.prisma.rankSnapshot.findMany({
          where: {
            workspaceId,
            projectId,
            id: { in: latestRankSnapshotIds }
          },
          select: {
            id: true,
            manifest: { select: { projectDomain: true } },
            serpResults: {
              orderBy: { position: "asc" },
              select: {
                position: true,
                rankingUrl: true,
                normalizedRankingUrl: true,
                faviconUrl: true,
                title: true,
                snippet: true
              }
            }
          }
        });
    const siteResultsBySnapshotId = new Map(
      currentSerpSnapshots.map((snapshot) => [
        snapshot.id,
        projectSiteResults(
          snapshot.serpResults,
          snapshot.manifest.projectDomain
        )
      ])
    );
    const positionsByKeywordId = new Map<
      string,
      Map<SemanticKeywordListPosition["searchEngine"], SemanticKeywordListPosition>
    >();
    for (const { rank, searchEngine } of latestRankByKeywordEngine.values()) {
      const positions = positionsByKeywordId.get(rank.keywordId) ?? new Map();
      const previousPosition = previousPositions.get(
        previousFoundPositionKey(
          rank.keywordId,
          searchEngine,
          rank.observedAt,
          rank.snapshotId
        )
      ) ?? rank.previousPosition ?? undefined;
      const siteResults = siteResultsBySnapshotId.get(rank.snapshotId) ?? [];
      positions.set(searchEngine, {
        searchEngine,
        found: rank.found,
        ...(rank.position === null ? {} : { position: rank.position }),
        ...(previousPosition === undefined ? {} : { previousPosition }),
        ...(rank.rankingUrl === null || rank.rankingUrl === undefined
          ? {}
          : { rankingUrl: rank.rankingUrl }),
        ...(siteResults.length === 0 ? {} : { siteResults }),
        observedAt: rank.observedAt.toISOString()
      });
      positionsByKeywordId.set(rank.keywordId, positions);
    }
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) =>
        keywordItem(
          row,
          row.targetPageId
            ? pageUrlById.get(row.targetPageId)
            : undefined,
          trackedKeywordIds.has(row.id),
          row.clusterId ? clusterNameById.get(row.clusterId) : undefined,
          frequenciesByKeywordId.get(row.id),
          [...(positionsByKeywordId.get(row.id)?.values() ?? [])],
          selectedGroupByKeywordId.get(row.id)
        )
      ),
      page: {
        hasNext,
        ...(totalApprox === undefined ? {} : { totalApprox }),
        ...(hasNext && last
          ? {
              nextCursor: encodeCursor({
                version: 2,
                id: last.id,
                sort,
                sortValue:
                  externalSortValueById.get(last.id) ?? cursorValue(last, sort),
                filterHash
              })
            }
          : {})
      },
      meta: { requestId }
    };
  }

  public async tagOptions(
    workspaceId: string,
    projectId: string,
    search?: string
  ): Promise<readonly string[]> {
    const normalizedSearch = normalizeTagName(search ?? "");
    const tags = await this.prisma.tag.findMany({
      where: {
        workspaceId,
        projectId,
        status: "ACTIVE",
        ...(normalizedSearch
          ? { normalizedName: { contains: normalizedSearch } }
          : {})
      },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      take: 100,
      select: { name: true }
    });
    return tags.map(({ name }) => name);
  }

  public async insights(
    workspaceId: string,
    projectId: string,
    keywordId: string
  ): Promise<SemanticKeywordInsights> {
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        id: keywordId,
        workspaceId,
        projectId,
        status: { in: ["ACTIVE", "DELETED"] }
      },
      select: { id: true, note: true }
    });
    if (!keyword) {
      throw new HttpException("Keyword not found", HttpStatus.NOT_FOUND);
    }
    const [frequencies, currentRanks, rankSnapshots] = await Promise.all([
      this.prisma.frequencySnapshot.findMany({
        where: { workspaceId, projectId, keywordId },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        take: 100
      }),
      this.prisma.currentRank.findMany({
        where: { workspaceId, projectId, keywordId },
        orderBy: [{ observedAt: "desc" }, { snapshotId: "desc" }],
        take: 50
      }),
      this.prisma.rankSnapshot.findMany({
        where: { workspaceId, projectId, keywordId },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        take: 240,
        select: {
          id: true,
          trackingContextId: true,
          configurationVersion: true,
          provider: true,
          found: true,
          position: true,
          observedAt: true,
          manifest: {
            select: { execution: true, projectDomain: true }
          }
        }
      })
    ]);
    const rankRows = [...currentRanks, ...rankSnapshots];
    const contextIds = [...new Set(rankRows.map(({ trackingContextId }) => trackingContextId))];
    const [contexts, configurations] = contextIds.length === 0
      ? [[], []] as const
      : await Promise.all([
          this.prisma.trackingContext.findMany({
            where: { workspaceId, projectId, id: { in: contextIds } },
            select: { id: true, name: true }
          }),
          this.prisma.trackingContextVersion.findMany({
            where: {
              workspaceId,
              projectId,
              OR: rankRows.map((rank) => ({
                contextId: rank.trackingContextId,
                configurationVersion: rank.configurationVersion
              }))
            },
            select: {
              contextId: true,
              configurationVersion: true,
              searchEngine: true,
              device: true,
              regionCode: true,
              regionLabel: true,
              countryCode: true,
              language: true,
              depth: true
            }
          })
        ]);
    const contextById = new Map(contexts.map((context) => [context.id, context]));
    const configurationById = new Map(
      configurations.map((configuration) => [
        `${configuration.contextId}:${configuration.configurationVersion}`,
        configuration
      ])
    );
    const currentRankAnchors = currentRanks.flatMap((rank) => {
      const configuration = configurationById.get(
        `${rank.trackingContextId}:${rank.configurationVersion}`
      );
      if (!configuration) return [];
      return [{
        keywordId,
        searchEngine: configuration.searchEngine as RankSearchEngine,
        observedAt: rank.observedAt,
        snapshotId: rank.snapshotId
      }];
    });
    const previousPositions = await previousFoundPositions(
      this.prisma,
      workspaceId,
      projectId,
      currentRankAnchors
    );
    const serpCandidateSnapshots = rankSnapshots.filter(
      ({ provider }) => provider === "ARSENKIN" || provider === "XMLSTOCK"
    );
    const rankSerpResults = serpCandidateSnapshots.length === 0
      ? []
      : await this.prisma.rankSerpResult.findMany({
          where: {
            snapshotId: {
              in: serpCandidateSnapshots.map(({ id }) => id)
            },
            position: { lte: 10 },
            snapshot: { workspaceId, projectId, keywordId }
          },
          orderBy: [
            { snapshotObservedAt: "desc" },
            { snapshotId: "desc" },
            { position: "asc" }
          ]
        });
    const serpResultsBySnapshotId = new Map<
      string,
      typeof rankSerpResults
    >();
    for (const result of rankSerpResults) {
      const rows = serpResultsBySnapshotId.get(result.snapshotId) ?? [];
      serpResultsBySnapshotId.set(result.snapshotId, [...rows, result]);
    }
    const latestSerpSnapshotByEngine = new Map<
      "GOOGLE" | "YANDEX",
      (typeof rankSnapshots)[number]
    >();
    for (const snapshot of serpCandidateSnapshots) {
      if ((serpResultsBySnapshotId.get(snapshot.id)?.length ?? 0) === 0) {
        continue;
      }
      const configuration = configurationById.get(
        `${snapshot.trackingContextId}:${snapshot.configurationVersion}`
      );
      if (
        configuration &&
        !latestSerpSnapshotByEngine.has(configuration.searchEngine)
      ) {
        latestSerpSnapshotByEngine.set(
          configuration.searchEngine,
          snapshot
        );
      }
    }
    const latestSerpSnapshots = [...latestSerpSnapshotByEngine.values()];
    return {
      keywordId,
      ...(keyword.note ? { note: keyword.note } : {}),
      frequencies: frequencies.map((snapshot) => ({
        type: frequencyType(snapshot.type),
        regionCode: snapshot.regionCode,
        device: frequencyDevice(snapshot.device),
        ...(snapshot.period === null ? {} : { period: snapshot.period }),
        ...(snapshot.value === null ? {} : { value: snapshot.value.toString() }),
        provider: snapshot.provider,
        sourceMode: snapshot.sourceMode,
        jobId: snapshot.jobId,
        qualityFlags: frequencyQualityFlags(snapshot.qualityFlags),
        observedAt: snapshot.observedAt.toISOString()
      })),
      positions: currentRanks.flatMap((rank) => {
        const context = contextById.get(rank.trackingContextId);
        const configuration = configurationById.get(
          `${rank.trackingContextId}:${rank.configurationVersion}`
        );
        if (!context || !configuration) return [];
        const searchEngine = configuration.searchEngine as RankSearchEngine;
        const previousPosition = previousPositions.get(
          previousFoundPositionKey(
            keywordId,
            searchEngine,
            rank.observedAt,
            rank.snapshotId
          )
        ) ?? rank.previousPosition ?? undefined;
        return [{
          trackingContextId: rank.trackingContextId,
          contextName: context.name,
          searchEngine,
          device: configuration.device,
          regionCode: configuration.regionCode ?? configuration.countryCode,
          found: rank.found,
          ...(rank.position === null ? {} : { position: rank.position }),
          ...(previousPosition === undefined ? {} : { previousPosition }),
          ...(rank.rankingUrl === null || rank.rankingUrl === undefined ? {} : { rankingUrl: rank.rankingUrl }),
          observedAt: rank.observedAt.toISOString()
        }];
      }),
      positionHistory: rankSnapshots.flatMap((snapshot) => {
        const context = contextById.get(snapshot.trackingContextId);
        const configuration = configurationById.get(
          `${snapshot.trackingContextId}:${snapshot.configurationVersion}`
        );
        if (!context || !configuration) return [];
        const searchSource = rankHistorySearchSource(
          snapshot.manifest.execution,
          configuration.searchEngine
        );
        return [{
          snapshotId: snapshot.id,
          trackingContextId: snapshot.trackingContextId,
          contextName: context.name,
          searchEngine: configuration.searchEngine,
          ...(searchSource ? { searchSource } : {}),
          device: configuration.device,
          regionCode: configuration.regionCode ?? configuration.countryCode,
          ...(configuration.regionLabel === null
            ? {}
            : { regionLabel: configuration.regionLabel }),
          countryCode: configuration.countryCode,
          language: configuration.language,
          depth: configuration.depth,
          provider: rankHistoryProvider(snapshot.provider),
          found: snapshot.found,
          ...(snapshot.position === null ? {} : { position: snapshot.position }),
          observedAt: snapshot.observedAt.toISOString()
        }];
      }),
      competitorSnapshots: latestSerpSnapshots.flatMap((snapshot) => {
        const context = contextById.get(snapshot.trackingContextId);
        const configuration = configurationById.get(
          `${snapshot.trackingContextId}:${snapshot.configurationVersion}`
        );
        const results = serpResultsBySnapshotId.get(snapshot.id) ?? [];
        if (!context || !configuration || results.length === 0) return [];
        const searchSource = rankHistorySearchSource(
          snapshot.manifest.execution,
          configuration.searchEngine
        );
        return [{
          snapshotId: snapshot.id,
          trackingContextId: snapshot.trackingContextId,
          contextName: context.name,
          searchEngine: configuration.searchEngine,
          ...(searchSource ? { searchSource } : {}),
          provider: competitorSnapshotProvider(snapshot.provider),
          observedAt: snapshot.observedAt.toISOString(),
          results: results.map((result) => ({
            position: result.position,
            url: result.rankingUrl,
            ...(result.faviconUrl === null || result.faviconUrl === undefined
              ? {}
              : { faviconUrl: result.faviconUrl }),
            ...(result.title === null ? {} : { title: result.title }),
            ...(result.snippet === null ? {} : { snippet: result.snippet })
          }))
        }];
      })
    };
  }

  public async deleteFrequencyContext(
    workspaceId: string,
    projectId: string,
    keywordId: string,
    type: SemanticFrequencyType,
    regionCode: string,
    device: SemanticFrequencyDevice
  ): Promise<void> {
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        id: keywordId,
        workspaceId,
        projectId,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (!keyword) {
      throw new HttpException("Keyword not found", HttpStatus.NOT_FOUND);
    }
    await this.prisma.frequencySnapshot.deleteMany({
      where: {
        workspaceId,
        projectId,
        keywordId,
        type,
        regionCode,
        device
      }
    });
  }

  public async create(
    input: InternalCreateSemanticKeywordInput,
    semanticVersion?: SemanticVersionIdentity
  ): Promise<SemanticKeywordListItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const normalized = normalizeRequiredKeyword(input.text);
        const normalizedHash = sha256(normalized);
        await lockStoredKeywordCapacity(
          transaction,
          input.workspaceId
        );
        await lockSemanticKeywordWrites(transaction, input.projectId);
        const existing = await transaction.keyword.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            language: input.language,
            normalizedHash
          },
          include: KEYWORD_INCLUDE
        });
        const isActiveDuplicate = existing?.status === "ACTIVE";
        const isTrashedDuplicate = existing?.status === "DELETED"
          ? Boolean(
              await transaction.keywordGroupMembership.findFirst({
                where: {
                  projectId: input.projectId,
                  keywordId: existing.id,
                  group: {
                    workspaceId: input.workspaceId,
                    projectId: input.projectId,
                    status: "ACTIVE",
                    systemKind: "TRASH"
                  }
                },
                select: { keywordId: true }
              })
            )
          : false;
        if (
          existing &&
          isActiveDuplicate &&
          input.duplicatePolicy === "ADD_TO_GROUP" &&
          input.groupId
        ) {
          const linkedGroup = await linkActiveKeywordToGroup(
            transaction,
            input.workspaceId,
            input.projectId,
            existing.id,
            input.groupId
          );
          if (linkedGroup) {
            const linked = await requiredKeyword(
              transaction,
              input.workspaceId,
              input.projectId,
              existing.id
            );
            return {
              ...keywordItem(
                linked,
                await targetUrlFor(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  linked.targetPageId
                ),
                await isKeywordTracked(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  linked.id
                ),
                await clusterNameFor(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  linked.clusterId
                ),
                [],
                [],
                linkedGroup
              ),
              createOutcome: "LINKED_EXISTING"
            };
          }
        }
        if (
          existing &&
          (isActiveDuplicate ||
            (isTrashedDuplicate && input.duplicatePolicy !== "RESTORE_TRASHED"))
        ) {
          if (
            input.duplicatePolicy === "REJECT_EXISTING" &&
            !isTrashedDuplicate
          ) {
            throw duplicateKeyword();
          }
          return {
            ...keywordItem(
              existing,
              await targetUrlFor(
                transaction,
                input.workspaceId,
                input.projectId,
                existing.targetPageId
              ),
              await isKeywordTracked(
                transaction,
                input.workspaceId,
                input.projectId,
                existing.id
              ),
              await clusterNameFor(
                transaction,
                input.workspaceId,
                input.projectId,
                existing.clusterId
              )
            ),
            createOutcome: "SKIPPED_EXISTING"
          };
        }
        if (!existing) {
          await assertStoredKeywordCapacity(
            transaction,
            input.workspaceId,
            input.projectId,
            1n,
            input.entitlement
          );
        }
        await lockKeywordGroupTree(transaction, input.projectId);
        if (input.clusterId) {
          await lockSemanticClusterSet(transaction, input.projectId);
        }
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          input.groupId
        );
        const systemGroups = await ensureKeywordSystemGroupIds(
          transaction,
          input.workspaceId,
          input.projectId
        );
        await assertCluster(
          transaction,
          input.workspaceId,
          input.projectId,
          input.clusterId
        );
        const pageId = input.targetUrl
          ? await resolvePage(
              transaction,
              input.workspaceId,
              input.projectId,
              input.actorId,
              input.targetUrl
            )
          : undefined;
        const tags = await resolveTags(
          transaction,
          input.workspaceId,
          input.projectId,
          input.tagNames
        );
        if (existing) {
          await lockKeyword(transaction, input.projectId, existing.id);
          const beforeState = keywordVersionState(existing);
          const restored = await transaction.keyword.updateMany({
            where: {
              id: existing.id,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              status: "DELETED",
              version: existing.version,
              language: input.language,
              normalizedHash
            },
            data: {
              textOriginal: input.text,
              note: input.note ?? null,
              textNormalized: normalized,
              normalizedHash,
              language: input.language,
              priority: input.priority,
              isFavorite: input.isFavorite,
              intent: input.intent ?? null,
              clusterId: input.clusterId ?? null,
              targetPageId: pageId ?? null,
              status: "ACTIVE",
              deletedAt: null,
              updatedBy: input.actorId,
              version: { increment: 1 }
            }
          });
          if (restored.count !== 1) {
            throw keywordVersionConflict(existing.version);
          }
          await transaction.keywordGroupMembership.deleteMany({
            where: { projectId: input.projectId, keywordId: existing.id }
          });
          await transaction.keywordGroupMembership.create({
            data: {
              projectId: input.projectId,
              keywordId: existing.id,
              groupId: input.groupId ?? systemGroups.UNGROUPED
            }
          });
          await transaction.keywordTag.deleteMany({
            where: { projectId: input.projectId, keywordId: existing.id }
          });
          if (tags.length > 0) {
            await transaction.keywordTag.createMany({
              data: tags.map((tag) => ({
                projectId: input.projectId,
                keywordId: existing.id,
                tagId: tag.id
              }))
            });
          }
          const result = await requiredKeyword(
            transaction,
            input.workspaceId,
            input.projectId,
            existing.id
          );
          const change = {
            entityId: result.id,
            operation: "UPDATE" as const,
            beforeState,
            afterState: keywordVersionState(result),
            beforeVersion: existing.version,
            afterVersion: result.version
          };
          if (semanticVersion) {
            await this.semanticVersions.appendBulkKeywordChange(
              transaction,
              semanticVersion,
              change
            );
          } else {
            await this.semanticVersions.createWithKeywordChange(
              transaction,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                reason: "KEYWORD_CREATE",
                summary: "Восстановлен поисковый запрос"
              },
              change
            );
          }
          return {
            ...keywordItem(
              result,
              input.targetUrl,
              await isKeywordTracked(
                transaction,
                input.workspaceId,
                input.projectId,
                result.id
              ),
              await clusterNameFor(
                transaction,
                input.workspaceId,
                input.projectId,
                result.clusterId
              )
            ),
            createOutcome: "RESTORED"
          };
        }
        const created = await transaction.keyword.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            textOriginal: input.text,
            note: input.note ?? null,
            textNormalized: normalized,
            normalizedHash,
            language: input.language,
            priority: input.priority,
            isFavorite: input.isFavorite,
            ...(input.intent ? { intent: input.intent } : {}),
            ...(input.clusterId ? { clusterId: input.clusterId } : {}),
            ...(pageId ? { targetPageId: pageId } : {}),
            sourceMode: "MANUAL",
            createdBy: input.actorId,
            updatedBy: input.actorId
          }
        });
        await transaction.keywordGroupMembership.create({
          data: {
            projectId: input.projectId,
            keywordId: created.id,
            groupId: input.groupId ?? systemGroups.UNGROUPED
          }
        });
        if (tags.length > 0) {
          await transaction.keywordTag.createMany({
            data: tags.map((tag) => ({
              projectId: input.projectId,
              keywordId: created.id,
              tagId: tag.id
            }))
          });
        }
        const result = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          created.id
        );
        const change = {
          entityId: result.id,
          operation: "CREATE" as const,
          beforeState: null,
          afterState: keywordVersionState(result),
          beforeVersion: null,
          afterVersion: result.version
        };
        if (semanticVersion) {
          await this.semanticVersions.appendBulkKeywordChange(
            transaction,
            semanticVersion,
            change
          );
        } else {
          await this.semanticVersions.createWithKeywordChange(
            transaction,
            {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              actorId: input.actorId,
              reason: "KEYWORD_CREATE",
              summary: "Добавлен поисковый запрос"
            },
            change
          );
        }
        return {
          ...keywordItem(
            result,
            input.targetUrl,
            false,
            await clusterNameFor(
              transaction,
              input.workspaceId,
              input.projectId,
              result.clusterId
            )
          ),
          createOutcome: "CREATED"
        };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateKeyword();
      throw error;
    }
  }

  public async bulkCreate(
    input: InternalSemanticKeywordBulkCreateInput
  ): Promise<SemanticKeywordBulkCreateResult> {
    const semanticVersion =
      await this.semanticVersions.createOpenBulkVersion({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        reason: "KEYWORD_CREATE",
        summary: `Добавление ${input.items.length} запросов`
      });
    const rows: SemanticKeywordBulkCreateResult["rows"][number][] = [];
    try {
      for (const [index, item] of input.items.entries()) {
        try {
          const keyword = await this.create(
            {
              ...item,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              actorId: input.actorId,
              entitlement: input.entitlement,
              duplicatePolicy: input.duplicatePolicy
            },
            semanticVersion
          );
          rows.push({
            index,
            outcome: keyword.createOutcome ?? "CREATED",
            keywordId: keyword.id,
            version: keyword.version,
            ...(keyword.trashed === true ? { trashed: true } : {})
          });
        } catch (error) {
          const code = semanticKeywordCreateErrorCode(error);
          rows.push({
            index,
            outcome: code === "DUPLICATE" ? "REJECTED_EXISTING" : "FAILED",
            errorCode: code
          });
        }
      }
    } finally {
      await this.semanticVersions.finalizeBulkVersion(semanticVersion);
    }
    const count = (outcome: SemanticKeywordCreateOutcome): number =>
      rows.filter((row) => row.outcome === outcome).length;
    return {
      selected: rows.length,
      created: count("CREATED"),
      restored: count("RESTORED"),
      linked: count("LINKED_EXISTING"),
      skipped: count("SKIPPED_EXISTING"),
      rejected: count("REJECTED_EXISTING"),
      failed: count("FAILED"),
      rows
    };
  }

  public async update(
    keywordId: string,
    input: InternalUpdateSemanticKeywordInput,
    semanticVersion?: SemanticVersionIdentity
  ): Promise<SemanticKeywordListItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockSemanticKeywordWrites(transaction, input.projectId);
        if (input.groupId !== undefined) {
          await lockKeywordGroupTree(transaction, input.projectId);
        }
        await lockKeyword(transaction, input.projectId, keywordId);
        if (input.clusterId !== undefined) {
          await lockSemanticClusterSet(transaction, input.projectId);
        }
        const current = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId
        );
        const beforeState = keywordVersionState(current);
        assertKeywordVersion(current.version, input.version);
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          input.groupId
        );
        await assertCluster(
          transaction,
          input.workspaceId,
          input.projectId,
          input.clusterId
        );
        const pageId =
          input.targetUrl === undefined
            ? undefined
            : input.targetUrl === null
              ? null
              : await resolvePage(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  input.actorId,
                  input.targetUrl
                );
        const tags =
          input.tagNames === undefined
            ? undefined
            : await resolveTags(
                transaction,
                input.workspaceId,
                input.projectId,
                input.tagNames
              );
        const normalized =
          input.text === undefined
            ? undefined
            : normalizeRequiredKeyword(input.text);
        await transaction.keyword.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: keywordId
            }
          },
          data: {
            ...(input.text === undefined
              ? {}
              : {
                  textOriginal: input.text,
                  textNormalized: normalized!,
                  normalizedHash: sha256(normalized!)
                }),
            ...(input.note === undefined ? {} : { note: input.note }),
            ...(input.language === undefined
              ? {}
              : { language: input.language }),
            ...(input.priority === undefined
              ? {}
              : { priority: input.priority }),
            ...(input.isFavorite === undefined
              ? {}
              : { isFavorite: input.isFavorite }),
            ...(input.intent === undefined ? {} : { intent: input.intent }),
            ...(input.clusterId === undefined
              ? {}
              : { clusterId: input.clusterId }),
            ...(pageId === undefined ? {} : { targetPageId: pageId }),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        if (input.groupId !== undefined) {
          const systemGroups = await ensureKeywordSystemGroupIds(
            transaction,
            input.workspaceId,
            input.projectId
          );
          await transaction.keywordGroupMembership.deleteMany({
            where: { projectId: input.projectId, keywordId }
          });
          await transaction.keywordGroupMembership.create({
            data: {
              projectId: input.projectId,
              keywordId,
              groupId: input.groupId ?? systemGroups.UNGROUPED
            }
          });
        }
        if (tags !== undefined) {
          await transaction.keywordTag.deleteMany({
            where: { projectId: input.projectId, keywordId }
          });
          if (tags.length > 0) {
            await transaction.keywordTag.createMany({
              data: tags.map((tag) => ({
                projectId: input.projectId,
                keywordId,
                tagId: tag.id
              }))
            });
          }
        }
        const result = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId
        );
        const targetUrl =
          input.targetUrl === undefined
            ? await targetUrlFor(
                transaction,
                input.workspaceId,
                input.projectId,
                result.targetPageId
              )
            : (input.targetUrl ?? undefined);
        const afterState = keywordVersionState(result);
        if (!sameKeywordVersionState(beforeState, afterState)) {
          const change = {
            entityId: result.id,
            operation: "UPDATE" as const,
            beforeState,
            afterState,
            beforeVersion: current.version,
            afterVersion: result.version
          };
          if (semanticVersion) {
            await this.semanticVersions.appendBulkKeywordChange(
              transaction,
              semanticVersion,
              change
            );
          } else {
            await this.semanticVersions.createWithKeywordChange(
              transaction,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                reason: "KEYWORD_UPDATE",
                summary: "Изменён поисковый запрос"
              },
              change
            );
          }
        }
        return keywordItem(
          result,
          targetUrl,
          await isKeywordTracked(
            transaction,
            input.workspaceId,
            input.projectId,
            keywordId
          ),
          await clusterNameFor(
            transaction,
            input.workspaceId,
            input.projectId,
            result.clusterId
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateKeyword();
      throw error;
    }
  }

  public async delete(
    keywordId: string,
    input: InternalDeleteSemanticKeywordInput
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await lockKeywordGroupTree(transaction, input.projectId);
      await lockKeyword(transaction, input.projectId, keywordId);
      const current = await transaction.keyword.findUnique({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: keywordId
          }
        },
        include: KEYWORD_INCLUDE
      });
      if (!current) {
        throw new HttpException(
          { code: "NOT_FOUND", message: "Semantic keyword not found" },
          HttpStatus.NOT_FOUND
        );
      }
      const beforeState = keywordVersionState(current);
      assertKeywordVersion(current.version, input.version);
      const systemGroups = await ensureKeywordSystemGroupIds(
        transaction,
        input.workspaceId,
        input.projectId
      );
      if (input.permanent === true) {
        const isTrashed =
          current.status === "DELETED" &&
          current.memberships.some(
            ({ group }) => group.id === systemGroups.TRASH
          );
        if (!isTrashed) {
          throw new HttpException(
            {
              code: "RESOURCE_STATE_CONFLICT",
              message: "Only trashed keywords can be permanently deleted"
            },
            HttpStatus.CONFLICT
          );
        }
        // Rank manifests and snapshots are deliberately immutable. Removing
        // their keyword row would either violate provenance FKs or require
        // weakening the audit trail. Permanent deletion therefore destroys
        // every user-controlled keyword value and releases its unique
        // identity while retaining an opaque tombstone for historical rows.
        await transaction.keywordGroupMembership.deleteMany({
          where: { projectId: input.projectId, keywordId }
        });
        await transaction.keywordTag.deleteMany({
          where: { projectId: input.projectId, keywordId }
        });
        await transaction.semanticKeywordCustomValue.deleteMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            keywordId
          }
        });
        await transaction.keyword.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: keywordId
            }
          },
          data: {
            textOriginal: "",
            textNormalized: `__purged__:${keywordId}`,
            normalizedHash: sha256(
              `purged:${input.workspaceId}:${input.projectId}:${keywordId}`
            ),
            language: "und",
            priority: 0,
            isFavorite: false,
            intent: null,
            clusterId: null,
            targetPageId: null,
            isTracked: false,
            customValues: {},
            note: null,
            sourceMode: "MANUAL",
            sourceId: null,
            createdBy: null,
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        return;
      }
      if (current.status !== "ACTIVE") {
        throw new HttpException(
          { code: "NOT_FOUND", message: "Semantic keyword not found" },
          HttpStatus.NOT_FOUND
        );
      }
      await transaction.keywordGroupMembership.deleteMany({
        where: { projectId: input.projectId, keywordId }
      });
      await transaction.keywordGroupMembership.create({
        data: {
          projectId: input.projectId,
          keywordId,
          groupId: systemGroups.TRASH
        }
      });
      await transaction.keyword.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: keywordId
          }
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      await this.semanticVersions.createWithKeywordChange(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "KEYWORD_DELETE",
          summary: "Удалён поисковый запрос"
        },
        {
          entityId: current.id,
          operation: "DELETE",
          beforeState,
          afterState: {
            ...beforeState,
            status: "DELETED",
            groupId: systemGroups.TRASH
          },
          beforeVersion: current.version,
          afterVersion: current.version + 1
        }
      );
    });
  }

  public async bulkUpdate(
    input: InternalSemanticKeywordBulkInput
  ): Promise<SemanticKeywordBulkResult> {
    const semanticVersion =
      await this.semanticVersions.createOpenBulkVersion({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        reason: "BULK_UPDATE",
        summary: `Массовое изменение ${input.items.length} запросов`
      });
    const updatedItems: SemanticKeywordListItem[] = [];
    const conflictedIds: string[] = [];
    const skippedIds: string[] = [];
    const failedIds: string[] = [];
    try {
      for (const item of input.items) {
        try {
          updatedItems.push(
            await this.update(
              item.id,
              {
                ...input.patch,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                version: item.version
              },
              semanticVersion
            )
          );
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          const status = error.getStatus();
          if (status === HttpStatus.PRECONDITION_FAILED) {
            conflictedIds.push(item.id);
          } else if (status === HttpStatus.NOT_FOUND) {
            skippedIds.push(item.id);
          } else if (
            status === HttpStatus.BAD_REQUEST ||
            status === HttpStatus.CONFLICT
          ) {
            failedIds.push(item.id);
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      await this.semanticVersions.finalizeBulkVersion(semanticVersion);
      throw error;
    }
    await this.semanticVersions.finalizeBulkVersion(semanticVersion);
    return {
      selected: input.items.length,
      changed: updatedItems.length,
      skipped: skippedIds.length,
      failed: failedIds.length,
      conflicted: conflictedIds.length,
      updatedItems,
      conflictedIds,
      skippedIds,
      failedIds
    };
  }

  public async previewCleaning(
    input: InternalSemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningPreview> {
    const rows = await this.prisma.keyword.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        id: { in: input.items.map(({ id }) => id) }
      },
      select: {
        id: true,
        textOriginal: true,
        language: true,
        version: true
      }
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const candidates: CleaningCandidate[] = input.items.map((item) => {
      const row = byId.get(item.id);
      if (!row) {
        return {
          keywordId: item.id,
          state: "UNAVAILABLE",
          expectedVersion: item.version
        };
      }
      const afterText = cleanKeywordText(row.textOriginal, input.rules);
      const change = {
        keywordId: item.id,
        expectedVersion: item.version,
        currentVersion: row.version,
        beforeText: row.textOriginal,
        afterText
      } as const;
      if (row.version !== item.version) {
        return { ...change, state: "CONFLICTED" };
      }
      const normalized = normalizeKeywordText(afterText);
      if (!normalized || Buffer.byteLength(afterText, "utf8") > 2_000) {
        return { ...change, state: "INVALID" };
      }
      if (afterText === row.textOriginal) {
        return { ...change, state: "UNCHANGED" };
      }
      return {
        ...change,
        state: "APPLICABLE",
        language: row.language,
        normalizedHash: sha256(normalized)
      };
    });
    const applicable = candidates.filter(
      (candidate): candidate is ApplicableCleaningCandidate =>
        candidate.state === "APPLICABLE"
    );
    const occupants = applicable.length === 0
      ? []
      : await this.prisma.keyword.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            OR: applicable.map(({ language, normalizedHash }) => ({
              language,
              normalizedHash
            }))
          },
          select: { id: true, language: true, normalizedHash: true }
        });
    const targetCounts = new Map<string, number>();
    for (const candidate of applicable) {
      const key = cleaningKey(candidate.language, candidate.normalizedHash);
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }
    const changes = candidates.map((candidate) => {
      if (!isApplicableCleaningCandidate(candidate)) {
        return publicCleaningChange(candidate);
      }
      const key = cleaningKey(candidate.language, candidate.normalizedHash);
      const duplicate =
        (targetCounts.get(key) ?? 0) > 1 ||
        occupants.some(
          (occupant) =>
            occupant.id !== candidate.keywordId &&
            cleaningKey(occupant.language, occupant.normalizedHash) === key
        );
      return publicCleaningChange(
        duplicate ? { ...candidate, state: "DUPLICATE" } : candidate
      );
    });
    return cleaningPreview(changes);
  }

  public async clean(
    input: InternalSemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningResult> {
    const preview = await this.previewCleaning(input);
    const updatedItems: SemanticKeywordListItem[] = [];
    const unchangedIds: string[] = [];
    const conflictedIds: string[] = [];
    const failedIds: string[] = [];
    const semanticVersion = preview.applicable > 0
      ? await this.semanticVersions.createOpenBulkVersion({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLEANING",
          summary: `Очистка ${input.items.length} запросов`
        })
      : undefined;
    try {
      for (const change of preview.changes) {
        if (change.state === "UNCHANGED") {
          unchangedIds.push(change.keywordId);
          continue;
        }
        if (change.state === "CONFLICTED") {
          conflictedIds.push(change.keywordId);
          continue;
        }
        if (change.state !== "APPLICABLE" || !semanticVersion) {
          failedIds.push(change.keywordId);
          continue;
        }
        try {
          updatedItems.push(
            await this.update(
              change.keywordId,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                version: change.expectedVersion,
                text: change.afterText!
              },
              semanticVersion
            )
          );
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          if (error.getStatus() === HttpStatus.PRECONDITION_FAILED) {
            conflictedIds.push(change.keywordId);
          } else if (
            error.getStatus() === HttpStatus.NOT_FOUND ||
            error.getStatus() === HttpStatus.BAD_REQUEST ||
            error.getStatus() === HttpStatus.CONFLICT
          ) {
            failedIds.push(change.keywordId);
          } else {
            throw error;
          }
        }
      }
    } finally {
      if (semanticVersion) {
        await this.semanticVersions.finalizeBulkVersion(semanticVersion);
      }
    }
    return {
      selected: input.items.length,
      changed: updatedItems.length,
      unchanged: unchangedIds.length,
      conflicted: conflictedIds.length,
      failed: failedIds.length,
      updatedItems,
      unchangedIds,
      conflictedIds,
      failedIds
    };
  }
}

type CleaningCandidate = SemanticKeywordCleaningPreviewChange &
  Readonly<{ language?: string; normalizedHash?: string }>;

type ApplicableCleaningCandidate = CleaningCandidate &
  Readonly<{
    state: "APPLICABLE";
    language: string;
    normalizedHash: string;
  }>;

function isApplicableCleaningCandidate(
  candidate: CleaningCandidate
): candidate is ApplicableCleaningCandidate {
  return (
    candidate.state === "APPLICABLE" &&
    candidate.language !== undefined &&
    candidate.normalizedHash !== undefined
  );
}

function publicCleaningChange(
  candidate: CleaningCandidate
): SemanticKeywordCleaningPreviewChange {
  return {
    keywordId: candidate.keywordId,
    state: candidate.state,
    expectedVersion: candidate.expectedVersion,
    ...(candidate.currentVersion === undefined
      ? {}
      : { currentVersion: candidate.currentVersion }),
    ...(candidate.beforeText === undefined
      ? {}
      : { beforeText: candidate.beforeText }),
    ...(candidate.afterText === undefined
      ? {}
      : { afterText: candidate.afterText })
  };
}

function cleaningPreview(
  changes: readonly SemanticKeywordCleaningPreviewChange[]
): SemanticKeywordCleaningPreview {
  return {
    selected: changes.length,
    applicable: changes.filter(({ state }) => state === "APPLICABLE").length,
    unchanged: changes.filter(({ state }) => state === "UNCHANGED").length,
    conflicted: changes.filter(({ state }) => state === "CONFLICTED").length,
    failed: changes.filter(({ state }) =>
      ["UNAVAILABLE", "DUPLICATE", "INVALID"].includes(state)
    ).length,
    changes
  };
}

function cleaningKey(language: string, normalizedHash: string): string {
  return `${language}\u0000${normalizedHash}`;
}

async function isKeywordTracked(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  keywordId: string
): Promise<boolean> {
  const assignment =
    await transaction.trackingContextKeywordAssignment.findFirst({
      where: {
        workspaceId,
        projectId,
        keywordId,
        removedAt: null,
        context: { status: "ACTIVE" }
      },
      select: { id: true }
    });
  return Boolean(assignment);
}

async function requiredKeyword(
  transaction: Prisma.TransactionClient | PrismaService,
  workspaceId: string,
  projectId: string,
  keywordId: string
): Promise<KeywordAggregate> {
  const keyword = await transaction.keyword.findUnique({
    where: {
      workspaceId_projectId_id: { workspaceId, projectId, id: keywordId }
    },
    include: KEYWORD_INCLUDE
  });
  if (!keyword || keyword.status !== "ACTIVE") {
    throw new HttpException(
      { code: "NOT_FOUND", message: "Semantic keyword not found" },
      HttpStatus.NOT_FOUND
    );
  }
  return keyword;
}

async function assertGroup(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  groupId: string | null | undefined
): Promise<void> {
  if (!groupId) return;
  const group = await transaction.keywordGroup.findFirst({
    where: { id: groupId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true, systemKind: true }
  });
  if (!group || group.systemKind === "TRASH") {
    throw new BadRequestException("Keyword group does not belong to project");
  }
}

async function linkActiveKeywordToGroup(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  keywordId: string,
  groupId: string
): Promise<
  Readonly<{ id: string; path: string | null; name: string }> | undefined
> {
  await lockKeywordGroupTree(transaction, projectId);
  const group = await transaction.keywordGroup.findFirst({
    where: { id: groupId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true, path: true, name: true, systemKind: true }
  });
  if (!group || group.systemKind !== null) {
    throw new BadRequestException(
      "An existing keyword can only be added to a regular project group"
    );
  }
  await lockKeyword(transaction, projectId, keywordId);
  const membership = await transaction.keywordGroupMembership.findFirst({
    where: { projectId, keywordId, groupId },
    select: { keywordId: true }
  });
  if (membership) return undefined;
  await transaction.keywordGroupMembership.create({
    data: { projectId, keywordId, groupId }
  });
  await transaction.keywordGroupMembership.deleteMany({
    where: {
      projectId,
      keywordId,
      group: {
        workspaceId,
        projectId,
        systemKind: "UNGROUPED"
      }
    }
  });
  return { id: group.id, path: group.path, name: group.name };
}

async function assertCluster(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string | null | undefined
): Promise<void> {
  if (!clusterId) return;
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true }
  });
  if (!cluster) {
    throw new BadRequestException("Semantic cluster does not belong to project");
  }
}

async function clusterNameFor(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string | null
): Promise<string | undefined> {
  if (!clusterId) return undefined;
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" },
    select: { name: true }
  });
  return cluster?.name;
}

async function resolveTags(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  names: readonly string[]
): Promise<readonly { readonly id: string }[]> {
  const result: { id: string }[] = [];
  for (const name of names) {
    const normalizedName = normalizeTagName(name);
    const tag = await transaction.tag.upsert({
      where: {
        projectId_normalizedName: { projectId, normalizedName }
      },
      create: {
        workspaceId,
        projectId,
        name,
        normalizedName
      },
      update: {
        name,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    result.push(tag);
  }
  return result;
}

async function resolvePage(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  actorId: string,
  source: string
): Promise<string> {
  const normalized = normalizePageUrl(source, "targetUrl");
  const existing = await transaction.page.findUnique({
    where: {
      projectId_urlHash: { projectId, urlHash: normalized.hash }
    },
    select: { id: true, workspaceId: true, status: true }
  });
  if (
    existing &&
    (existing.workspaceId !== workspaceId || existing.status !== "ACTIVE")
  ) {
    throw new HttpException(
      {
        code: "RESOURCE_STATE_CONFLICT",
        message: "Target page is not an active page in this workspace"
      },
      HttpStatus.CONFLICT
    );
  }
  const page = await transaction.page.upsert({
    where: {
      projectId_urlHash: { projectId, urlHash: normalized.hash }
    },
    create: {
      workspaceId,
      projectId,
      url: normalized.original,
      normalizedUrl: normalized.normalized,
      urlHash: normalized.hash,
      createdBy: actorId,
      updatedBy: actorId
    },
    update: {
      // Page identity and lifecycle are owned by the Page Map. Assigning the
      // same URL to another keyword must not create an invisible page edit.
    },
    select: { id: true }
  });
  await transaction.pageSource.upsert({
    where: {
      pageId_source: { pageId: page.id, source: "MANUAL" }
    },
    create: {
      workspaceId,
      projectId,
      pageId: page.id,
      source: "MANUAL"
    },
    update: { lastSeenAt: new Date() }
  });
  return page.id;
}

async function targetUrlFor(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  pageId: string | null
): Promise<string | undefined> {
  if (!pageId) return undefined;
  const page = await transaction.page.findFirst({
    where: {
      id: pageId,
      workspaceId,
      projectId,
      status: "ACTIVE"
    },
    select: { url: true }
  });
  return page?.url;
}

async function lockKeyword(
  transaction: Prisma.TransactionClient,
  projectId: string,
  keywordId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "keywords"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${keywordId}::uuid
    FOR UPDATE
  `;
}

async function lockKeywordGroupTree(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-group-tree:${projectId}`}, 0)
    )
  `;
}

async function lockSemanticClusterSet(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-cluster-set:${projectId}`}, 0)
    )
  `;
}

function keywordItem(
  row: KeywordAggregate,
  targetUrl: string | undefined,
  isTracked: boolean,
  clusterName?: string,
  frequencies: readonly SemanticKeywordListFrequencyValue[] = [],
  positions: readonly SemanticKeywordListPosition[] = [],
  displayGroup?: Readonly<{ id: string; path: string | null; name: string }>
): SemanticKeywordListItem {
  const tags = row.tags.slice(0, 50).map(({ tag }) => tag.name);
  const group = displayGroup ?? row.memberships[0]?.group;
  const baseFrequency = frequencies.find(({ type }) => type === "BASE");
  const legacyBaseFrequency = baseFrequency
    ? {
        ...(baseFrequency.value === undefined
          ? {}
          : { value: baseFrequency.value }),
        regionCode: baseFrequency.regionCode,
        device: baseFrequency.device,
        provider: baseFrequency.provider,
        observedAt: baseFrequency.observedAt
      }
    : undefined;
  return {
    id: row.id,
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    isTracked,
    ...(row.intent
      ? {
          intent: row.intent as SemanticKeywordIntent
        }
      : {}),
    ...(group ? { groupId: group.id, groupPath: group.path ?? group.name } : {}),
    ...(row.clusterId ? { clusterId: row.clusterId } : {}),
    ...(clusterName ? { clusterName } : {}),
    ...(row.targetPageId ? { targetPageId: row.targetPageId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tags,
    tagsTruncated: row.tags.length > 50,
    hasNote: Boolean(row.note?.trim()),
    customValues: (row.typedCustomValues ?? []).map(keywordCustomValue),
    ...(legacyBaseFrequency ? { frequency: legacyBaseFrequency } : {}),
    ...(frequencies.length > 0 ? { frequencies } : {}),
    ...(positions.length > 0 ? { positions } : {}),
    sourceMode: row.sourceMode,
    ...(row.status === "DELETED" ? { trashed: true } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version
  };
}

function keywordVersionState(
  row: KeywordAggregate
): SemanticKeywordVersionState {
  return {
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    normalizedHash: row.normalizedHash,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    intent: row.intent,
    status: row.status === "DELETED" ? "DELETED" : "ACTIVE",
    clusterId: row.clusterId,
    targetPageId: row.targetPageId,
    groupId: row.memberships[0]?.group.id ?? null,
    tagIds: row.tags.map(({ tag }) => tag.id)
  };
}

function sameKeywordVersionState(
  left: SemanticKeywordVersionState,
  right: SemanticKeywordVersionState
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function keywordCustomValue(
  row: KeywordAggregate["typedCustomValues"][number]
) {
  return {
    columnId: row.columnId,
    value: keywordCustomValueData(row),
    version: row.version,
    updatedAt: row.updatedAt.toISOString()
  };
}

function keywordCustomValueData(
  row: KeywordAggregate["typedCustomValues"][number]
) {
  switch (row.column.type) {
    case "TEXT":
    case "LONG_TEXT":
    case "SELECT":
    case "STATUS":
    case "URL":
      return row.textValue!;
    case "INTEGER":
      return Number(row.integerValue!);
    case "DECIMAL":
      return row.decimalValue!.toString();
    case "BOOLEAN":
      return row.booleanValue!;
    case "DATE":
      return row.dateValue!.toISOString().slice(0, 10);
    case "DATETIME":
      return row.datetimeValue!.toISOString();
    case "MULTI_SELECT":
      return row.stringArrayValue;
    case "USER":
      return row.userId!;
  }
}

function assertKeywordVersion(current: number, expected: number): void {
  if (current === expected) return;
  throw keywordVersionConflict(current);
}

function keywordVersionConflict(current: number): HttpException {
  return new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic keyword version conflict",
      currentVersion: current
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function duplicateKeyword(): HttpException {
  return new HttpException(
    {
      code: "DUPLICATE",
      message: "This keyword already exists in the project"
    },
    HttpStatus.CONFLICT
  );
}

function semanticKeywordCreateErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "object" && response !== null) {
      const body = response as Readonly<Record<string, unknown>>;
      if (typeof body.code === "string") return body.code;
      if (typeof body.error === "object" && body.error !== null) {
        const nested = body.error as Readonly<Record<string, unknown>>;
        if (typeof nested.code === "string") return nested.code;
      }
    }
    if (error.getStatus() === HttpStatus.BAD_REQUEST) return "INVALID_INPUT";
    if (error.getStatus() === HttpStatus.NOT_FOUND) return "NOT_FOUND";
    if (error.getStatus() === HttpStatus.CONFLICT) {
      return "RESOURCE_STATE_CONFLICT";
    }
  }
  return "INTERNAL_ERROR";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function normalizeRequiredKeyword(value: string): string {
  const normalized = normalizeKeywordText(value);
  if (!normalized) throw new BadRequestException("Keyword text is empty");
  return normalized;
}

function normalizeTagName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeCursor(value: KeywordCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  sort: SemanticKeywordSort,
  filterHash: string
): KeywordCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw invalidCursor();
  }
  const cursor = parsed as Readonly<Record<string, unknown>>;
  if (
    cursor.version !== 2 ||
    typeof cursor.id !== "string" ||
    !UUID_PATTERN.test(cursor.id) ||
    cursor.sort !== sort ||
    cursor.filterHash !== filterHash ||
    (typeof cursor.sortValue !== "string" &&
      typeof cursor.sortValue !== "number")
  ) {
    throw invalidCursor();
  }
  return {
    version: 2,
    id: cursor.id,
    sort,
    sortValue: cursor.sortValue,
    filterHash
  };
}

function keywordFilterHash(
  query: KeywordListQuery,
  normalizedSearch: string,
  normalizedTag: string
): string {
  return sha256(
    JSON.stringify({
      search: normalizedSearch,
      tag: normalizedTag,
      intent: query.intent ?? null,
      groupId: query.groupId ?? null,
      groupIds: query.groupIds ?? null,
      clusterId: query.clusterId ?? null,
      isFavorite: query.isFavorite ?? null,
      isTracked: query.isTracked ?? null,
      priorityMin: query.priorityMin ?? null,
      priorityMax: query.priorityMax ?? null
    })
  );
}

function keywordOrderBy(
  sort: SemanticKeywordSort
): Prisma.KeywordOrderByWithRelationInput[] {
  switch (sort) {
    case "CREATED_ASC":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "UPDATED_DESC":
      return [{ updatedAt: "desc" }, { id: "desc" }];
    case "UPDATED_ASC":
      return [{ updatedAt: "asc" }, { id: "asc" }];
    case "TEXT_ASC":
      return [{ textNormalized: "asc" }, { id: "asc" }];
    case "TEXT_DESC":
      return [{ textNormalized: "desc" }, { id: "desc" }];
    case "PRIORITY_DESC":
      return [{ priority: "desc" }, { id: "desc" }];
    case "PRIORITY_ASC":
      return [{ priority: "asc" }, { id: "asc" }];
    case "SOURCE_ASC":
      return [{ sourceMode: "asc" }, { id: "asc" }];
    case "SOURCE_DESC":
      return [{ sourceMode: "desc" }, { id: "desc" }];
    case "TAGS_ASC":
    case "TAGS_DESC":
      throw new Error("Tag keyword sorts are resolved by tagSortedKeywordPage");
    case "CREATED_DESC":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "FREQUENCY_BASE_DESC":
    case "FREQUENCY_BASE_ASC":
    case "FREQUENCY_EXACT_DESC":
    case "FREQUENCY_EXACT_ASC":
    case "FREQUENCY_FIXED_DESC":
    case "FREQUENCY_FIXED_ASC":
    case "YANDEX_POSITION_ASC":
    case "YANDEX_POSITION_DESC":
    case "GOOGLE_POSITION_ASC":
    case "GOOGLE_POSITION_DESC":
    case "YANDEX_CHECKED_AT_ASC":
    case "YANDEX_CHECKED_AT_DESC":
    case "GOOGLE_CHECKED_AT_ASC":
    case "GOOGLE_CHECKED_AT_DESC":
      throw new Error("Metric keyword sorts are resolved by metricSortedKeywordPage");
  }
}

function cursorValue(
  row: KeywordAggregate,
  sort: SemanticKeywordSort
): string | number {
  switch (sort) {
    case "CREATED_ASC":
    case "CREATED_DESC":
      return row.createdAt.toISOString();
    case "UPDATED_DESC":
    case "UPDATED_ASC":
      return row.updatedAt.toISOString();
    case "TEXT_ASC":
    case "TEXT_DESC":
      return row.textNormalized;
    case "PRIORITY_DESC":
    case "PRIORITY_ASC":
      return row.priority;
    case "SOURCE_ASC":
    case "SOURCE_DESC":
      return row.sourceMode;
    case "TAGS_ASC":
    case "TAGS_DESC":
      throw new Error("Tag cursor value is provided by tagSortedKeywordPage");
    case "FREQUENCY_BASE_DESC":
    case "FREQUENCY_BASE_ASC":
    case "FREQUENCY_EXACT_DESC":
    case "FREQUENCY_EXACT_ASC":
    case "FREQUENCY_FIXED_DESC":
    case "FREQUENCY_FIXED_ASC":
    case "YANDEX_POSITION_ASC":
    case "YANDEX_POSITION_DESC":
    case "GOOGLE_POSITION_ASC":
    case "GOOGLE_POSITION_DESC":
    case "YANDEX_CHECKED_AT_ASC":
    case "YANDEX_CHECKED_AT_DESC":
    case "GOOGLE_CHECKED_AT_ASC":
    case "GOOGLE_CHECKED_AT_DESC":
      throw new Error("Metric cursor value is provided by metricSortedKeywordPage");
  }
}

function cursorWhere(cursor: KeywordCursor): Prisma.KeywordWhereInput {
  if (isExternalKeywordSort(cursor.sort)) throw invalidCursor();
  const ascending = isAscendingKeywordSort(cursor.sort);
  const idDirection = ascending ? "gt" : "lt";
  const comparison = ascending ? "gt" : "lt";
  const field =
    cursor.sort === "UPDATED_DESC" || cursor.sort === "UPDATED_ASC"
      ? "updatedAt"
      : cursor.sort === "TEXT_ASC" || cursor.sort === "TEXT_DESC"
        ? "textNormalized"
        : cursor.sort === "PRIORITY_DESC" || cursor.sort === "PRIORITY_ASC"
          ? "priority"
          : cursor.sort === "SOURCE_ASC" || cursor.sort === "SOURCE_DESC"
            ? "sourceMode"
          : "createdAt";
  const value =
    field === "priority"
      ? requiredCursorNumber(cursor.sortValue)
      : field === "textNormalized" || field === "sourceMode"
        ? requiredCursorString(cursor.sortValue)
        : requiredCursorDate(cursor.sortValue);
  return {
    OR: [
      { [field]: { [comparison]: value } },
      {
        [field]: value,
        id: { [idDirection]: cursor.id }
      }
    ]
  };
}

function isMetricKeywordSort(sort: SemanticKeywordSort): boolean {
  return (
    sort.startsWith("FREQUENCY_") ||
    sort.startsWith("YANDEX_POSITION_") ||
    sort.startsWith("GOOGLE_POSITION_") ||
    sort.startsWith("YANDEX_CHECKED_AT_") ||
    sort.startsWith("GOOGLE_CHECKED_AT_")
  );
}

function isExternalKeywordSort(sort: SemanticKeywordSort): boolean {
  return isMetricKeywordSort(sort) || sort === "TAGS_ASC" || sort === "TAGS_DESC";
}

function previousFoundPositionKey(
  keywordId: string,
  searchEngine: RankSearchEngine,
  observedAt: Date,
  snapshotId: string
): string {
  return `${keywordId}:${searchEngine}:${observedAt.toISOString()}:${snapshotId}`;
}

async function previousFoundPositions(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  anchors: readonly PreviousFoundPositionAnchor[]
): Promise<ReadonlyMap<string, number>> {
  if (anchors.length === 0) return new Map();
  const serializedAnchors = anchors.map((anchor) => ({
    keyword_id: anchor.keywordId,
    search_engine: anchor.searchEngine,
    observed_at: anchor.observedAt.toISOString(),
    snapshot_id: anchor.snapshotId
  }));
  const rows = await prisma.$queryRaw<readonly PreviousFoundPositionRow[]>`
    WITH anchors AS (
      SELECT
        anchor.keyword_id,
        anchor.search_engine,
        anchor.observed_at,
        anchor.snapshot_id
      FROM jsonb_to_recordset(${JSON.stringify(serializedAnchors)}::jsonb) AS anchor(
        keyword_id uuid,
        search_engine text,
        observed_at timestamptz,
        snapshot_id uuid
      )
    )
    SELECT
      anchors.keyword_id::text AS "keywordId",
      anchors.search_engine AS "searchEngine",
      anchors.observed_at AS "observedAt",
      anchors.snapshot_id::text AS "snapshotId",
      previous.position AS "previousPosition"
    FROM anchors
    INNER JOIN LATERAL (
      SELECT snapshot.position
      FROM rank_snapshots snapshot
      INNER JOIN tracking_context_versions configuration
        ON configuration.workspace_id = snapshot.workspace_id
       AND configuration.project_id = snapshot.project_id
       AND configuration.context_id = snapshot.tracking_context_id
       AND configuration.configuration_version = snapshot.configuration_version
      WHERE snapshot.workspace_id = ${workspaceId}::uuid
        AND snapshot.project_id = ${projectId}::uuid
        AND snapshot.keyword_id = anchors.keyword_id
        AND configuration.search_engine::text = anchors.search_engine
        AND snapshot.found = TRUE
        AND snapshot.position IS NOT NULL
        AND (snapshot.observed_at, snapshot.id) <
            (anchors.observed_at, anchors.snapshot_id)
      ORDER BY snapshot.observed_at DESC, snapshot.id DESC
      LIMIT 1
    ) previous ON TRUE
  `;
  const expectedKeys = new Set(
    anchors.map((anchor) =>
      previousFoundPositionKey(
        anchor.keywordId,
        anchor.searchEngine,
        anchor.observedAt,
        anchor.snapshotId
      )
    )
  );
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = previousFoundPositionKey(
      row.keywordId,
      row.searchEngine,
      row.observedAt,
      row.snapshotId
    );
    if (
      !expectedKeys.has(key) ||
      !Number.isSafeInteger(row.previousPosition) ||
      row.previousPosition <= 0 ||
      result.has(key)
    ) {
      throw new HttpException(
        "Invalid previous rank projection",
        HttpStatus.BAD_GATEWAY
      );
    }
    result.set(key, row.previousPosition);
  }
  return result;
}

async function metricSortedKeywordPage(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  query: KeywordListQuery,
  search: string,
  tag: string,
  sort: SemanticKeywordSort,
  cursor: KeywordCursor | undefined,
  keywordStatus: "ACTIVE" | "DELETED"
): Promise<Readonly<{
  ids: readonly string[];
  sortValueById: Map<string, string>;
}>> {
  const ascending = sort.endsWith("_ASC");
  const positionSort =
    sort.startsWith("YANDEX_POSITION_") ||
    sort.startsWith("GOOGLE_POSITION_");
  const positionBucket = 1_000_000n;
  const nullSentinel = positionSort
    ? ascending
      ? positionBucket * 2n
      : 0n
    : ascending
      ? 9_223_372_036_854_775_807n
      : -1n;
  const rankEngine = sort.startsWith("YANDEX_") ? "YANDEX" : "GOOGLE";
  const positionMetric = ascending
    ? Prisma.sql`CASE
        WHEN latest_rank.found THEN latest_rank.position::bigint
        WHEN latest_rank.historical_position IS NOT NULL
          THEN ${positionBucket}::bigint + latest_rank.historical_position::bigint
        ELSE ${positionBucket * 2n}::bigint
      END`
    : Prisma.sql`CASE
        WHEN latest_rank.found
          THEN ${positionBucket * 2n}::bigint + latest_rank.position::bigint
        WHEN latest_rank.historical_position IS NOT NULL
          THEN ${positionBucket}::bigint + latest_rank.historical_position::bigint
        ELSE 0::bigint
      END`;
  const metricJoin = sort.startsWith("FREQUENCY_")
    ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT fs.value AS metric
          FROM frequency_snapshots fs
          WHERE fs.workspace_id = k.workspace_id
            AND fs.project_id = k.project_id
            AND fs.keyword_id = k.id
            AND fs.type = ${frequencyTypeForSort(sort)}
          ORDER BY fs.observed_at DESC, fs.id DESC
          LIMIT 1
        ) metric_source ON TRUE`
    : positionSort
      ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT ${positionMetric} AS metric
          FROM (
            SELECT
              cr.found,
              cr.position,
              COALESCE(
                (
                  SELECT previous.position
                  FROM rank_snapshots previous
                  INNER JOIN tracking_context_versions previous_tcv
                    ON previous_tcv.workspace_id = previous.workspace_id
                   AND previous_tcv.project_id = previous.project_id
                   AND previous_tcv.context_id = previous.tracking_context_id
                   AND previous_tcv.configuration_version = previous.configuration_version
                  WHERE previous.workspace_id = cr.workspace_id
                    AND previous.project_id = cr.project_id
                    AND previous.keyword_id = cr.keyword_id
                    AND previous.found = TRUE
                    AND previous.position IS NOT NULL
                    AND previous_tcv.search_engine::text = ${rankEngine}
                    AND (previous.observed_at, previous.id) <
                        (cr.observed_at, cr.snapshot_id)
                  ORDER BY previous.observed_at DESC, previous.id DESC
                  LIMIT 1
                ),
                cr.previous_position
              ) AS historical_position
            FROM current_ranks cr
            INNER JOIN tracking_context_versions tcv
              ON tcv.workspace_id = cr.workspace_id
             AND tcv.project_id = cr.project_id
             AND tcv.context_id = cr.tracking_context_id
             AND tcv.configuration_version = cr.configuration_version
            WHERE cr.workspace_id = k.workspace_id
              AND cr.project_id = k.project_id
              AND cr.keyword_id = k.id
              AND tcv.search_engine::text = ${rankEngine}
            ORDER BY cr.observed_at DESC, cr.snapshot_id DESC,
                     cr.tracking_context_id DESC
            LIMIT 1
          ) latest_rank
        ) metric_source ON TRUE`
      : Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT floor(extract(epoch from cr.observed_at) * 1000)::bigint AS metric
          FROM current_ranks cr
          INNER JOIN tracking_context_versions tcv
            ON tcv.workspace_id = cr.workspace_id
           AND tcv.project_id = cr.project_id
           AND tcv.context_id = cr.tracking_context_id
           AND tcv.configuration_version = cr.configuration_version
          WHERE cr.workspace_id = k.workspace_id
            AND cr.project_id = k.project_id
            AND cr.keyword_id = k.id
            AND tcv.search_engine::text = ${rankEngine}
          ORDER BY cr.observed_at DESC, cr.snapshot_id DESC,
                   cr.tracking_context_id DESC
          LIMIT 1
        ) metric_source ON TRUE`;
  const filters = keywordRawFilters(
    workspaceId,
    projectId,
    query,
    search,
    tag,
    keywordStatus
  );
  const cursorValue = cursor
    ? requiredMetricCursorValue(cursor.sortValue)
    : undefined;
  const cursorClause = cursorValue === undefined
    ? Prisma.empty
    : ascending
      ? Prisma.sql`WHERE (ranked.sort_value, ranked.id) > (${cursorValue}::bigint, ${cursor!.id}::uuid)`
      : Prisma.sql`WHERE (ranked.sort_value, ranked.id) < (${cursorValue}::bigint, ${cursor!.id}::uuid)`;
  const order = ascending
    ? Prisma.sql`ranked.sort_value ASC, ranked.id ASC`
    : Prisma.sql`ranked.sort_value DESC, ranked.id DESC`;
  const rows = await prisma.$queryRaw<readonly Readonly<{ id: string; sort_value: bigint }>[]>
    `
      SELECT ranked.id, ranked.sort_value
      FROM (
        SELECT k.id, COALESCE(metric_source.metric, ${nullSentinel}::bigint) AS sort_value
        FROM keywords k
        ${metricJoin}
        WHERE ${Prisma.join(filters, " AND ")}
      ) ranked
      ${cursorClause}
      ORDER BY ${order}
      LIMIT ${query.limit + 1}
    `;
  return {
    ids: rows.map(({ id }) => id),
    sortValueById: new Map(rows.map(({ id, sort_value }) => [id, sort_value.toString()]))
  };
}

async function tagSortedKeywordPage(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  query: KeywordListQuery,
  search: string,
  tag: string,
  sort: SemanticKeywordSort,
  cursor: KeywordCursor | undefined,
  keywordStatus: "ACTIVE" | "DELETED"
): Promise<Readonly<{
  ids: readonly string[];
  sortValueById: Map<string, string>;
}>> {
  const ascending = sort === "TAGS_ASC";
  const missingValue = ascending ? "\u{10ffff}" : "";
  const filters = keywordRawFilters(
    workspaceId,
    projectId,
    query,
    search,
    tag,
    keywordStatus
  );
  const cursorValue = cursor
    ? requiredCursorString(cursor.sortValue)
    : undefined;
  const cursorClause = cursorValue === undefined
    ? Prisma.empty
    : ascending
      ? Prisma.sql`WHERE (ranked.sort_value, ranked.id) > (${cursorValue}::text, ${cursor!.id}::uuid)`
      : Prisma.sql`WHERE (ranked.sort_value, ranked.id) < (${cursorValue}::text, ${cursor!.id}::uuid)`;
  const order = ascending
    ? Prisma.sql`ranked.sort_value ASC, ranked.id ASC`
    : Prisma.sql`ranked.sort_value DESC, ranked.id DESC`;
  const rows = await prisma.$queryRaw<readonly Readonly<{
    id: string;
    sort_value: string;
  }>[]>`
    SELECT ranked.id, ranked.sort_value
    FROM (
      SELECT
        k.id,
        COALESCE(tag_source.tag_name, ${missingValue}::text) AS sort_value
      FROM keywords k
      LEFT JOIN LATERAL (
        SELECT MIN(t.normalized_name) AS tag_name
        FROM keyword_tags kt
        INNER JOIN tags t
          ON t.id = kt.tag_id
         AND t.workspace_id = k.workspace_id
         AND t.project_id = k.project_id
         AND t.status::text = 'ACTIVE'
        WHERE kt.project_id = k.project_id
          AND kt.keyword_id = k.id
      ) tag_source ON TRUE
      WHERE ${Prisma.join(filters, " AND ")}
    ) ranked
    ${cursorClause}
    ORDER BY ${order}
    LIMIT ${query.limit + 1}
  `;
  return {
    ids: rows.map(({ id }) => id),
    sortValueById: new Map(
      rows.map(({ id, sort_value }) => [id, sort_value])
    )
  };
}

function keywordRawFilters(
  workspaceId: string,
  projectId: string,
  query: KeywordListQuery,
  search: string,
  tag: string,
  keywordStatus: "ACTIVE" | "DELETED"
): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [
    Prisma.sql`k.workspace_id = ${workspaceId}::uuid`,
    Prisma.sql`k.project_id = ${projectId}::uuid`,
    Prisma.sql`k.status::text = ${keywordStatus}`
  ];
  if (search) filters.push(Prisma.sql`strpos(k.text_normalized, ${search}) > 0`);
  if (tag) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM keyword_tags filter_kt
      INNER JOIN tags filter_tag
        ON filter_tag.id = filter_kt.tag_id
       AND filter_tag.workspace_id = k.workspace_id
       AND filter_tag.project_id = k.project_id
       AND filter_tag.status::text = 'ACTIVE'
      WHERE filter_kt.project_id = k.project_id
        AND filter_kt.keyword_id = k.id
        AND strpos(filter_tag.normalized_name, ${tag}) > 0
    )`);
  }
  if (query.intent) filters.push(Prisma.sql`k.intent::text = ${query.intent}`);
  if (query.isFavorite !== undefined) filters.push(Prisma.sql`k.is_favorite = ${query.isFavorite}`);
  if (query.priorityMin !== undefined) filters.push(Prisma.sql`k.priority >= ${query.priorityMin}`);
  if (query.priorityMax !== undefined) filters.push(Prisma.sql`k.priority <= ${query.priorityMax}`);
  const groupIds = query.groupIds?.length
    ? query.groupIds
    : query.groupId
      ? [query.groupId]
      : [];
  if (groupIds.length > 0) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1 FROM keyword_group_memberships kgm
      WHERE kgm.project_id = k.project_id
        AND kgm.keyword_id = k.id
        AND kgm.group_id IN (${Prisma.join(
          groupIds.map((groupId) => Prisma.sql`${groupId}::uuid`)
        )})
    )`);
  }
  if (query.clusterId) filters.push(Prisma.sql`k.cluster_id = ${query.clusterId}::uuid`);
  if (query.isTracked !== undefined) {
    const tracked = Prisma.sql`EXISTS (
      SELECT 1
      FROM tracking_context_keyword_assignments tcka
      INNER JOIN tracking_contexts tc
        ON tc.workspace_id = tcka.workspace_id
       AND tc.project_id = tcka.project_id
       AND tc.id = tcka.context_id
      WHERE tcka.workspace_id = k.workspace_id
        AND tcka.project_id = k.project_id
        AND tcka.keyword_id = k.id
        AND tcka.removed_at IS NULL
        AND tc.status::text = 'ACTIVE'
    )`;
    filters.push(query.isTracked ? tracked : Prisma.sql`NOT (${tracked})`);
  }
  return filters;
}

function frequencyTypeForSort(sort: SemanticKeywordSort): "BASE" | "EXACT" | "FIXED" {
  if (sort.includes("_EXACT_")) return "EXACT";
  if (sort.includes("_FIXED_")) return "FIXED";
  return "BASE";
}

function requiredMetricCursorValue(value: string | number): bigint {
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) throw invalidCursor();
  try {
    return BigInt(value);
  } catch {
    throw invalidCursor();
  }
}

function isAscendingKeywordSort(sort: SemanticKeywordSort): boolean {
  return sort.endsWith("_ASC");
}

function requiredCursorNumber(value: string | number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidCursor();
  }
  return value;
}

function requiredCursorString(value: string | number): string {
  if (typeof value !== "string") throw invalidCursor();
  return value;
}

function requiredCursorDate(value: string | number): Date {
  if (typeof value !== "string") throw invalidCursor();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidCursor();
  return date;
}

function invalidCursor(): BadRequestException {
  return new BadRequestException(
    "Keyword cursor is invalid for the current query"
  );
}

function frequencyType(value: string): "BASE" | "EXACT" | "FIXED" {
  if (value === "BASE" || value === "EXACT" || value === "FIXED") {
    return value;
  }
  throw new Error("Stored frequency type is unsupported");
}

function frequencyDevice(value: string): SemanticFrequencyDevice {
  if (
    value === "ALL" ||
    value === "DESKTOP" ||
    value === "MOBILE" ||
    value === "PHONE_ONLY" ||
    value === "TABLET_ONLY"
  ) return value;
  throw new Error("Stored frequency device is unsupported");
}

function frequencyQualityFlags(value: unknown): readonly SemanticFrequencyQualityFlag[] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new Error("Stored frequency quality flags are invalid");
  }
  const flags = value.map((flag): SemanticFrequencyQualityFlag => {
    if (
      flag === "CONTEXT_INCOMPLETE" ||
      flag === "STALE" ||
      flag === "PARTIAL" ||
      flag === "ESTIMATED"
    ) return flag;
    throw new Error("Stored frequency quality flag is unsupported");
  });
  if (new Set(flags).size !== flags.length) {
    throw new Error("Stored frequency quality flags contain duplicates");
  }
  return flags;
}

function rankHistoryProvider(
  value: string
): SemanticKeywordPositionHistoryProvider {
  if (
    value === "ARSENKIN" ||
    value === "XMLSTOCK" ||
    value === "KEY_COLLECTOR"
  ) return value;
  throw new Error("Stored rank history provider is unsupported");
}

function competitorSnapshotProvider(
  value: string
): "ARSENKIN" | "XMLSTOCK" {
  if (value === "ARSENKIN" || value === "XMLSTOCK") return value;
  throw new Error("Stored SERP snapshot provider is unsupported");
}
