import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalFrequencyKeyword,
  InternalPersistFrequencySnapshotsInput,
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
}
