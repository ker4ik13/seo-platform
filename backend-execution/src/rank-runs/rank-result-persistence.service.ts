import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalIngestRankChunkInput,
  InternalIngestRankBatchInput,
  InternalRankChunkIngestCommand,
  InternalRankManifestChunk
} from "@seo-platform/contracts";
import { rankResultBatchMaxItems } from "@seo-platform/contracts";
import { rankChunkIngestHash } from "@seo-platform/contracts/rank-results-canonical";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  RankManifestClient,
  RankManifestClientError
} from "../seo-data/rank-manifest.client.js";
import {
  RankResultClient,
  RankResultClientError
} from "../seo-data/rank-result.client.js";
import {
  RankResultPersistenceBrokerService,
  RankResultPersistenceLeaseLostError,
  type RankResultPersistenceClaim
} from "./rank-result-persistence-broker.service.js";

export type RankResultPersistenceOutcome =
  | "IDLE"
  | "PERSISTED"
  | "RETRY_PENDING"
  | "LEASE_LOST";

@Injectable()
export class RankResultPersistenceService {
  public constructor(
    private readonly broker: RankResultPersistenceBrokerService,
    private readonly manifests: RankManifestClient,
    private readonly results: RankResultClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async processOne(
    leaseOwner: string
  ): Promise<RankResultPersistenceOutcome> {
    try {
      const claim = await this.broker.claim(
        leaseOwner,
        this.leaseSeconds()
      );
      if (!claim) return "IDLE";
      return this.persistOne(claim);
    } catch (error) {
      if (error instanceof RankResultPersistenceLeaseLostError) {
        return "LEASE_LOST";
      }
      throw error;
    }
  }

  public async processBatch(leaseOwner: string): Promise<number> {
    const claims = await this.broker.claimBatch(
      leaseOwner,
      this.batchLeaseSeconds(),
      rankResultBatchMaxItems
    );
    const groups = new Map<string, RankResultPersistenceClaim[]>();
    for (const claim of claims) {
      const key = claim.request.provider === "XMLSTOCK"
        ? `${claim.workspaceId}:${claim.projectId}:${claim.request.actorId}:${claim.manifestId}`
        : claim.executionId;
      const group = groups.get(key) ?? [];
      group.push(claim);
      groups.set(key, group);
    }
    let firstError: unknown;
    await Promise.all([...groups.values()].map(async (group) => {
      if (group.length === 1) {
        try {
          await this.persistOne(group[0]!);
        } catch (error) {
          firstError ??= error;
        }
        return;
      }
      let committed = false;
      try {
        const first = group[0]!;
        const chunks = await this.manifests.getChunks({
          workspaceId: first.workspaceId,
          projectId: first.projectId,
          actorId: first.request.actorId,
          jobId: first.jobId,
          manifestId: first.manifestId,
          chunkIndices: [...new Set(group.map((claim) => claim.manifestChunkIndex))]
        });
        const chunksByIndex = new Map(chunks.map((chunk) => [chunk.chunkIndex, chunk]));
        const items = await Promise.all(group.map((claim) => {
          const chunk = chunksByIndex.get(claim.manifestChunkIndex);
          if (!chunk) throw new RankManifestClientError("UNAVAILABLE", true);
          return this.command(claim, chunk);
        }));
        const input: InternalIngestRankBatchInput = {
          schemaVersion: "rank-ingest-batch@1",
          workspaceId: first.workspaceId,
          projectId: first.projectId,
          actorId: first.request.actorId,
          manifestId: first.manifestId,
          items
        };
        await this.results.ingestBatch(input);
        committed = true;
      } catch (error) {
        if (error instanceof RankResultClientError && !error.retryable) {
          for (const claim of group) {
            try {
              await this.persistOne(claim);
            } catch (singleError) {
              firstError ??= singleError;
            }
          }
        } else {
          try {
            await this.broker.completeBatch(group, false);
          } catch (completionError) {
            firstError ??= completionError;
          }
          if (!(error instanceof RankResultClientError && error.retryable)) {
            firstError ??= error;
          }
        }
      }
      if (committed) {
        try {
          await this.broker.completeBatch(group, true);
        } catch (error) {
          firstError ??= error;
        }
      }
    }));
    if (firstError) throw firstError;
    return claims.length;
  }

  private async persistOne(
    claim: RankResultPersistenceClaim
  ): Promise<RankResultPersistenceOutcome> {
    try {
      const input = await this.command(claim);
      await this.results.ingest(input);
    } catch (error) {
      if (
        (error instanceof RankManifestClientError ||
          error instanceof RankResultClientError) &&
        error.retryable
      ) {
        await this.broker.complete(claim, false);
        return "RETRY_PENDING";
      }
      await this.broker.complete(claim, false);
      throw error;
    }
    await this.broker.complete(claim, true);
    return "PERSISTED";
  }

  private async command(
    claim: RankResultPersistenceClaim,
    preloadedChunk?: InternalRankManifestChunk
  ): Promise<InternalIngestRankChunkInput> {
    const chunk = preloadedChunk ?? await this.manifests.getChunk(
      {
        workspaceId: claim.workspaceId,
        projectId: claim.projectId,
        jobId: claim.jobId,
        manifestId: claim.manifestId,
        chunkIndex: claim.manifestChunkIndex
      },
      claim.request.actorId
    );
    const command: InternalRankChunkIngestCommand = {
      schemaVersion: "rank-ingest@1",
      workspaceId: claim.workspaceId,
      projectId: claim.projectId,
      actorId: claim.request.actorId,
      jobId: claim.jobId,
      jobItemId: claim.jobItemId,
      manifestId: claim.manifestId,
      chunkIndex: claim.manifestChunkIndex,
      manifestChunkHash: claim.manifestChunkHash,
      provider: claim.request.provider,
      operation: "POSITIONS",
      providerRequestId: claim.staged.providerRequestId,
      connectorVersion: claim.staged.connectorVersion,
      observedAt: claim.staged.observedAt,
      results: claim.staged.results
    };
    return {
      ...command,
      ingestEnvelopeHash: rankChunkIngestHash(command, chunk)
    };
  }

  private leaseSeconds(): number {
    return Math.min(
      300,
      Math.max(
        10,
        Math.ceil((this.config.internalCommandTimeoutMs + 5_000) / 1_000)
      )
    );
  }

  private batchLeaseSeconds(): number {
    return Math.min(300, Math.max(60,
      Math.ceil((Math.max(this.config.internalCommandTimeoutMs, 130_000) + 30_000) / 1_000)
    ));
  }
}
