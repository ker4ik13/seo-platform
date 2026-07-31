import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalIngestRankChunkInput,
  InternalRankChunkIngestCommand
} from "@seo-platform/contracts";
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
  RankResultPersistenceLeaseLostError
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
      try {
        const chunk = await this.manifests.getChunk(
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
          provider: "ARSENKIN",
          operation: "POSITIONS",
          providerRequestId: claim.staged.providerRequestId,
          connectorVersion: claim.staged.connectorVersion,
          observedAt: claim.staged.observedAt,
          results: claim.staged.results
        };
        const input: InternalIngestRankChunkInput = {
          ...command,
          ingestEnvelopeHash: rankChunkIngestHash(command, chunk)
        };
        await this.results.ingest(input);
        await this.broker.complete(claim, true);
        return "PERSISTED";
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
    } catch (error) {
      if (error instanceof RankResultPersistenceLeaseLostError) {
        return "LEASE_LOST";
      }
      throw error;
    }
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
}
