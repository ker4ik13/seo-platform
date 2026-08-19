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
    const keywordPage = await this.keywords.list(
      context.workspaceId,
      context.projectId,
      query,
      requestId
    );
    const keywordIds = keywordPage.data.map(({ id }) => id);
    const snapshots = keywordIds.length === 0
      ? []
      : await this.prisma.rankSnapshot.findMany({
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            keywordId: { in: keywordIds },
            sourceMode: "BYOK",
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
                configuration: { select: { searchEngine: true } }
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
      const identity = `${snapshot.keywordId}:${searchEngine}:${observedDate}`;
      // Several tracking contexts may check the same keyword and engine on
      // one day. The immutable newest snapshot wins, independently of context.
      if (observedKeywordDates.has(identity)) continue;
      observedKeywordDates.add(identity);
      const projected = positionSnapshot(
        searchEngine,
        observedDate,
        snapshot.found,
        snapshot.position
      );
      const items = snapshotsByKeyword.get(snapshot.keywordId) ?? [];
      items.push(projected);
      snapshotsByKeyword.set(snapshot.keywordId, items);
    }
    return {
      data: keywordPage.data.map((keyword) => ({
        keywordId: keyword.id,
        text: keyword.textOriginal,
        createdAt: keyword.createdAt,
        ...(keyword.groupPath ? { groupPath: keyword.groupPath } : {}),
        snapshots: snapshotsByKeyword.get(keyword.id) ?? []
      })),
      page: keywordPage.page,
      meta: keywordPage.meta
    };
  }
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
