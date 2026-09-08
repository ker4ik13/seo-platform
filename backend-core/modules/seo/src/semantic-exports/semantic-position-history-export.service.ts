import { Prisma } from "../generated/prisma/client.js";
import { parseSemanticRankDimensionKey, semanticPositionHistoryReadPageSize } from "@seo-platform/contracts";
import { rankDimensionMetadata } from "../rank-results/rank-dimension.js";
import { Injectable } from "@nestjs/common";
import type {
  ApiCollectionResponse,
  KeywordListQuery,
  SemanticPositionHistoryExportOptions,
  SemanticPositionHistoryExportRow,
  SemanticPositionHistoryExportSnapshot
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { KeywordService } from "../keywords/keyword.service.js";

@Injectable()
export class SemanticPositionHistoryExportService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly keywords: KeywordService
  ) {}

  public async list(
    context: Readonly<{
      workspaceId: string;
      projectId: string;
    }>,
    query: KeywordListQuery,
    options: SemanticPositionHistoryExportOptions,
    requestId: string
  ): Promise<ApiCollectionResponse<SemanticPositionHistoryExportRow>> {
    if (options.dimensionKeys?.length && query.limit > semanticPositionHistoryReadPageSize(options)) throw new Error("History keyword page exceeds its bounded size");
    const keywordPage = await this.keywords.list(
      context.workspaceId,
      context.projectId,
      query,
      requestId
    );
    const keywordIds = keywordPage.data.map(({ id }) => id);
    const snapshots = keywordIds.length === 0
      ? []
      : options.dimensionKeys?.length
        ? await this.groupedSnapshots(context, keywordIds, options)
        : await this.prisma.rankSnapshot.findMany({
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            keywordId: { in: keywordIds },
            sourceMode: { in: ["BYOK", "PLATFORM", "IMPORT"] },
            positionTrackingEnabled: true,
            observedAt: {
              gte: new Date(options.observedFrom),
              lt: new Date(options.observedBefore)
            },
            manifest: {
              configuration: {
                searchEngine: { in: [...options.searchEngines] }
              }
            }
          },
          orderBy: [{ observedAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            keywordId: true,
            observedAt: true,
            found: true,
            position: true,
            manifest: {
              select: {
                configuration: { select: { searchEngine: true, countryCode: true, regionCode: true, regionLabel: true, language: true, device: true } }
              }
            }
          }
        });
    const snapshotsByKeyword = new Map<
      string,
      SemanticPositionHistoryExportSnapshot[]
    >();
    const observedKeywordDates = new Set<string>();
    for (const snapshot of snapshots) {
      const searchEngine = snapshot.manifest.configuration.searchEngine;
      if (!options.searchEngines.includes(searchEngine)) {
        throw new Error("Stored rank snapshot has an unexpected search engine");
      }
      const observedDate = snapshot.observedAt.toISOString().slice(0, 10);
      const dimension = rankDimensionMetadata(snapshot.manifest.configuration);
      const identity = `${snapshot.keywordId}:${dimension.dimensionKey}:${observedDate}`;
      // Only repeated checks of the same geographic/device slice on one day
      // coalesce. Other cities and devices remain separate export rows.
      if (observedKeywordDates.has(identity)) continue;
      observedKeywordDates.add(identity);
      const projected = positionSnapshot(
        searchEngine,
        observedDate,
        snapshot.found,
        snapshot.position
      );
      const items = snapshotsByKeyword.get(snapshot.keywordId) ?? [];
      items.push({ ...projected, ...dimension });
      snapshotsByKeyword.set(snapshot.keywordId, items);
    }
    return {
      data: keywordPage.data.flatMap((keyword) => {
        const base = { keywordId: keyword.id, text: keyword.textOriginal, keywordLanguage: keyword.language, createdAt: keyword.createdAt, ...(keyword.groupPath ? { groupPath: keyword.groupPath } : {}) };
        const groups = new Map<string, SemanticPositionHistoryExportSnapshot[]>();
        for (const snapshot of snapshotsByKeyword.get(keyword.id) ?? []) {
          const key = snapshot.dimensionKey ?? snapshot.searchEngine;
          const values = groups.get(key) ?? []; values.push(snapshot); groups.set(key, values);
        }
        if (!groups.size) return [{ ...base, snapshots: [] }];
        return [...groups].map(([key, snapshots]) => {
          const dimension = parseSemanticRankDimensionKey(key);
          return { ...base,
            ...(dimension ? { dimension: { ...dimension, ...(snapshots[0]?.regionLabel ? { regionLabel: snapshots[0].regionLabel } : {}) } } : {}),
            snapshots: [...snapshots]
              .sort((left, right) => right.observedDate.localeCompare(left.observedDate))
              .map(snapshot => ({ searchEngine: snapshot.searchEngine, observedDate: snapshot.observedDate, found: snapshot.found, ...(snapshot.position === undefined ? {} : { position: snapshot.position }) }))
          };
        });
      }),
      page: keywordPage.page,
      meta: keywordPage.meta
    };
  }
  private groupedSnapshots(context: { workspaceId: string; projectId: string }, keywordIds: readonly string[], options: SemanticPositionHistoryExportOptions): Promise<StoredSnapshot[]> {
    if (!options.dimensionKeys?.length || options.dimensionKeys.length > 4) throw new Error("History read requires 1 to 4 geographic partitions");
    const dimensions = options.dimensionKeys.map(key => {
      const value = parseSemanticRankDimensionKey(key);
      if (!value || !options.searchEngines.includes(value.searchEngine)) throw new Error("Invalid history export dimension");
      return Prisma.sql`(configuration.search_engine::text = ${value.searchEngine} AND configuration.country_code = ${value.countryCode}
        AND COALESCE(configuration.region_code, configuration.country_code) = ${value.regionCode}
        AND configuration.language = ${value.language} AND configuration.device::text = ${value.device})`;
    });
    const day = Prisma.sql`(snapshot.observed_at AT TIME ZONE 'UTC')::date`;
    return this.prisma.$queryRaw<StoredSnapshot[]>(Prisma.sql`
      SELECT DISTINCT ON (snapshot.keyword_id, configuration.search_engine, configuration.country_code,
        COALESCE(configuration.region_code, configuration.country_code), configuration.language, configuration.device, ${day})
        snapshot.id, snapshot.keyword_id AS "keywordId", snapshot.observed_at AS "observedAt", snapshot.found, snapshot.position,
        jsonb_build_object('configuration', jsonb_build_object('searchEngine', configuration.search_engine,
          'countryCode', configuration.country_code, 'regionCode', configuration.region_code, 'regionLabel', configuration.region_label,
          'language', configuration.language, 'device', configuration.device)) AS manifest
      FROM rank_snapshots snapshot
      JOIN tracking_context_versions configuration ON configuration.workspace_id = snapshot.workspace_id AND configuration.project_id = snapshot.project_id
        AND configuration.context_id = snapshot.tracking_context_id AND configuration.configuration_version = snapshot.configuration_version
      WHERE snapshot.workspace_id = ${context.workspaceId}::uuid AND snapshot.project_id = ${context.projectId}::uuid
        AND snapshot.keyword_id IN (${Prisma.join(keywordIds.map(id => Prisma.sql`${id}::uuid`))})
        AND snapshot.source_mode::text IN ('BYOK', 'PLATFORM', 'IMPORT') AND snapshot.position_tracking_enabled
        AND snapshot.observed_at >= ${new Date(options.observedFrom)} AND snapshot.observed_at < ${new Date(options.observedBefore)}
        ${options.storedBefore ? Prisma.sql`AND snapshot.created_at < ${new Date(options.storedBefore)}` : Prisma.empty}
        AND (${Prisma.join(dimensions, ' OR ')})
      ORDER BY snapshot.keyword_id, configuration.search_engine, configuration.country_code,
        COALESCE(configuration.region_code, configuration.country_code), configuration.language, configuration.device, ${day}, snapshot.observed_at DESC, snapshot.id DESC
    `);
  }
}

interface StoredSnapshot {
  id: string; keywordId: string; observedAt: Date; found: boolean; position: number | null;
  manifest: { configuration: { searchEngine: "YANDEX" | "GOOGLE"; countryCode: string; regionCode: string | null; regionLabel: string | null; language: string; device: "DESKTOP" | "MOBILE" } };
}

function positionSnapshot(
  searchEngine: "GOOGLE" | "YANDEX",
  observedDate: string,
  found: boolean,
  position: number | null
): SemanticPositionHistoryExportSnapshot {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(observedDate)) {
    throw new Error("Stored rank snapshot has an invalid observed date");
  }
  if (!found) {
    if (position !== null) {
      throw new Error("Stored not-found rank snapshot has a position");
    }
    return { searchEngine, observedDate, found: false };
  }
  if (!Number.isSafeInteger(position) || position === null || position < 1 || position > 100) {
    throw new Error("Stored found rank snapshot has an invalid position");
  }
  return { searchEngine, observedDate, found: true, position };
}
