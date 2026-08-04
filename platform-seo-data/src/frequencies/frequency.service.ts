import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalFrequencyKeyword,
  InternalFrequencyKeywords,
  InternalPersistFrequencySnapshotBatchInput,
  InternalPersistFrequencySnapshotsInput,
  InternalResolveFrequencyKeywordsInput,
  InternalResolveFrequencyKeywordInput
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class FrequencyService {
  public constructor(private readonly prisma: PrismaService) {}

  public async resolve(
    input: InternalResolveFrequencyKeywordInput
  ): Promise<InternalFrequencyKeyword> {
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        id: input.keywordId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE"
      },
      select: { id: true, textOriginal: true, version: true }
    });
    if (!keyword) throw new NotFoundException("Keyword not found");
    if (keyword.version !== input.version) {
      throw new ConflictException("Keyword changed after collection started");
    }
    return { id: keyword.id, text: keyword.textOriginal, version: keyword.version };
  }

  public async resolveBatch(
    input: InternalResolveFrequencyKeywordsInput
  ): Promise<InternalFrequencyKeywords> {
    const keywords = await this.prisma.keyword.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        id: { in: input.items.map((item) => item.id) }
      },
      select: { id: true, textOriginal: true, version: true }
    });
    if (keywords.length !== input.items.length) {
      throw new NotFoundException("One or more frequency keywords were not found");
    }
    const byId = new Map(keywords.map((keyword) => [keyword.id, keyword]));
    const items = input.items.map((item) => {
      const keyword = byId.get(item.id);
      if (!keyword) {
        throw new NotFoundException("One or more frequency keywords were not found");
      }
      if (keyword.version !== item.version) {
        throw new ConflictException(
          "One or more keywords changed after collection started"
        );
      }
      return {
        id: keyword.id,
        text: keyword.textOriginal,
        version: keyword.version
      };
    });
    return { items };
  }

  public async persist(
    input: InternalPersistFrequencySnapshotsInput
  ): Promise<{ readonly created: number }> {
    return this.prisma.$transaction(async (transaction) => {
      const keyword = await transaction.keyword.findFirst({
        where: {
          id: input.keywordId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE"
        },
        select: { version: true }
      });
      if (!keyword) throw new NotFoundException("Keyword not found");
      if (keyword.version !== input.keywordVersion) {
        throw new ConflictException("Keyword changed before frequency persistence");
      }
      const result = await transaction.frequencySnapshot.createMany({
        data: input.snapshots.map((snapshot) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          keywordId: input.keywordId,
          type: snapshot.type,
          regionCode: snapshot.regionCode,
          device: snapshot.device,
          ...(snapshot.period ? { period: snapshot.period } : {}),
          value: BigInt(snapshot.value),
          observedAt: new Date(input.observedAt),
          provider: snapshot.provider,
          sourceMode: snapshot.sourceMode,
          jobId: input.jobId,
          qualityFlags: [...snapshot.qualityFlags]
        })),
        skipDuplicates: true
      });
      return { created: result.count };
    });
  }

  public async persistBatch(
    input: InternalPersistFrequencySnapshotBatchInput
  ): Promise<{ readonly created: number }> {
    return this.prisma.$transaction(async (transaction) => {
      const keywords = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          id: { in: input.items.map((item) => item.keywordId) }
        },
        select: { id: true, version: true }
      });
      if (keywords.length !== input.items.length) {
        throw new NotFoundException(
          "One or more frequency keywords were not found"
        );
      }
      const versions = new Map(
        keywords.map((keyword) => [keyword.id, keyword.version])
      );
      if (
        input.items.some(
          (item) => versions.get(item.keywordId) !== item.keywordVersion
        )
      ) {
        throw new ConflictException(
          "One or more keywords changed before frequency persistence"
        );
      }
      const result = await transaction.frequencySnapshot.createMany({
        data: input.items.flatMap((item) =>
          item.snapshots.map((snapshot) => ({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            keywordId: item.keywordId,
            type: snapshot.type,
            regionCode: snapshot.regionCode,
            device: snapshot.device,
            ...(snapshot.period ? { period: snapshot.period } : {}),
            value: BigInt(snapshot.value),
            observedAt: new Date(input.observedAt),
            provider: snapshot.provider,
            sourceMode: snapshot.sourceMode,
            jobId: input.jobId,
            qualityFlags: [...snapshot.qualityFlags]
          }))
        ),
        skipDuplicates: true
      });
      return { created: result.count };
    });
  }
}
