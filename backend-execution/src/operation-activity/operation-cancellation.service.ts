import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { RankRunService } from "../rank-runs/rank-run.service.js";
import { FrequencyCollectionService } from "../frequency-collections/frequency-collection.service.js";
import { AiAnswerCollectionService } from "../ai-answer-collections/ai-answer-collection.service.js";
import { ClusteringRunService } from "../clustering-runs/clustering-run.service.js";
import { KeywordResearchService } from "../keyword-research/keyword-research.service.js";
import { CrawlService } from "../crawls/crawl.service.js";
import { SemanticExportService } from "../semantic-exports/semantic-export.service.js";

/** Delegates cancellation to each existing owning workflow; never edits its state by hand. */
@Injectable()
export class OperationCancellationService {
  public constructor(private readonly prisma: PrismaService, private readonly ranks: RankRunService, private readonly frequency: FrequencyCollectionService, private readonly ai: AiAnswerCollectionService, private readonly clustering: ClusteringRunService, private readonly research: KeywordResearchService, private readonly crawl: CrawlService, private readonly exports: SemanticExportService) {}
  public async cancel(id: string, actorId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({ where: { id }, select: { workspaceId: true, projectId: true, type: true, version: true, technicalCrawl: { select: { id: true, version: true } }, keywordResearchRun: { select: { id: true, version: true } } } });
    if (!job?.projectId) throw new NotFoundException("Operation not found");
    const scope = { workspaceId: job.workspaceId, projectId: job.projectId, actorId };
    switch (job.type) {
      case "MANUAL_RANK_CHECK": await this.ranks.cancel({ ...scope, jobId: id }); break;
      case "FREQUENCY_COLLECTION": await this.frequency.cancel(id, scope); break;
      case "AI_ANSWER_COLLECTION": await this.ai.cancel(id, scope); break;
      case "CLUSTERING_RUN": await this.clustering.cancel(id, scope); break;
      case "KEYWORD_RESEARCH":
        if (!job.keywordResearchRun) throw new NotFoundException();
        await this.research.cancel(job.keywordResearchRun.id, { ...scope, version: job.keywordResearchRun.version }); break;
      case "SEMANTIC_EXPORT": await this.exports.cancel(id, { ...scope, version: job.version }); break;
      case "TECHNICAL_CRAWL":
        if (!job.technicalCrawl) throw new NotFoundException();
        await this.crawl.cancel(job.technicalCrawl.id, { ...scope, version: job.technicalCrawl.version }); break;
      default: throw new BadRequestException("Этот тип операции не поддерживает остановку");
    }
  }
}
