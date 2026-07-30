import { timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  InternalGetRankManifestChunkInput,
  InternalRankExecutionParameters,
  RankManifestHash
} from "@seo-platform/contracts";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import { Prisma } from "../generated/prisma/client.js";
import type {
  Job,
  JobItem,
  RankEstimate,
  RankJobRun,
  RankProviderRequestIntent
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  RankManifestClient,
  RankManifestClientError
} from "../seo-data/rank-manifest.client.js";
import {
  ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION
} from "./rank-execution-evidence.js";
import {
  lockRankJobGraph,
  lockRankJobItem
} from "./rank-job-lock.js";
import { rankJobItemReference } from "./rank-job-item.js";
import {
  storedRankManifestCommand,
  type RankManifestCommandBinding
} from "./rank-manifest-command.js";
import {
  MANUAL_RANK_CHECK_JOB_TYPE
} from "./rank-job-record.js";
import {
  RANK_PROVIDER_REQUEST_INTENT_SCHEMA,
  buildRankProviderRequestIntent,
  rankProviderRequestIntent,
  rankProviderRequestIntentCanonicalJson,
  rankProviderRequestIntentHash,
  type RankProviderRequestIntentV1
} from "./rank-provider-request-intent.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type RankProviderRequestIntentErrorCode =
  | "ITEM_NOT_FOUND"
  | "LOCAL_STATE_INVALID"
  | "DEPENDENCY_UNAVAILABLE";

export class RankProviderRequestIntentError extends Error {
  public constructor(
    public readonly code: RankProviderRequestIntentErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "RankProviderRequestIntentError";
  }
}

type RankIntentJobGraph = Job & {
  readonly rankRun:
    | (RankJobRun & { readonly estimate: RankEstimate })
    | null;
};

export interface RankProviderRequestIntentBinding {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly estimateId: string;
  readonly projectDomain: string;
  readonly projectVersion: number;
  readonly execution: InternalRankExecutionParameters;
  readonly manifestId: string;
  readonly manifestHash: Uint8Array;
  readonly manifestPairCount: number;
  readonly manifestChunkIndex: number;
  readonly executionConnectorVersion: string;
  readonly providerPolicyVersion: string;
}

interface RankProviderRequestIntentSource {
  readonly binding: RankProviderRequestIntentBinding;
  readonly command: ReturnType<typeof storedRankManifestCommand>;
  readonly chunkInput: InternalGetRankManifestChunkInput;
  readonly manifestHash: RankManifestHash;
  readonly existing: RankProviderRequestIntent | null;
}

/**
 * Materializes the privacy-sensitive provider adapter command exactly once.
 * The sealed keyword chunk is fetched outside database locks; the complete
 * immutable graph is locked and revalidated again before the snapshot is
 * inserted. Only the intent row contains keyword text.
 */
@Injectable()
export class RankProviderRequestIntentService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly manifests: RankManifestClient
  ) {}

  public async ensureForItem(
    jobItemId: string
  ): Promise<RankProviderRequestIntent> {
    if (!UUID_V7_PATTERN.test(jobItemId)) {
      throw intentFailure("ITEM_NOT_FOUND", false);
    }

    try {
      const pointer = await this.prisma.jobItem.findUnique({
        where: { id: jobItemId },
        select: { jobId: true }
      });
      if (!pointer) throw intentFailure("ITEM_NOT_FOUND", false);

      const source = await this.lockedSource(pointer.jobId, jobItemId);
      const chunk = await this.manifests.getChunk(
        source.chunkInput,
        source.binding.actorId
      );
      const candidate = buildRankProviderRequestIntent({
        command: source.command,
        chunk,
        jobItemId,
        manifestHash: source.manifestHash,
        executionConnectorVersion:
          source.binding.executionConnectorVersion,
        providerPolicyVersion: source.binding.providerPolicyVersion
      });

      return await this.prisma.$transaction(
        async (transaction) => {
          const current = await lockedIntentSource(
            transaction,
            pointer.jobId,
            jobItemId
          );
          if (current.existing) {
            const replay = storedRankProviderRequestIntent(
              current.existing,
              current.binding
            );
            assertSameIntent(replay, candidate);
            return current.existing;
          }

          const rebuilt = buildRankProviderRequestIntent({
            command: current.command,
            chunk,
            jobItemId,
            manifestHash: current.manifestHash,
            executionConnectorVersion:
              current.binding.executionConnectorVersion,
            providerPolicyVersion:
              current.binding.providerPolicyVersion
          });
          assertSameIntent(rebuilt, candidate);
          const requestHash = rankProviderRequestIntentHash(candidate);
          const created =
            await transaction.rankProviderRequestIntent.create({
              data: {
                workspaceId: current.binding.workspaceId,
                projectId: current.binding.projectId,
                jobId: current.binding.jobId,
                jobItemId: current.binding.jobItemId,
                manifestId: current.binding.manifestId,
                manifestHash: Buffer.from(
                  current.binding.manifestHash
                ),
                manifestChunkIndex:
                  current.binding.manifestChunkIndex,
                manifestChunkHash: Buffer.from(
                  candidate.manifestChunk.chunkHash.value,
                  "hex"
                ),
                schemaVersion: RANK_PROVIDER_REQUEST_INTENT_SCHEMA,
                requestSnapshot: JSON.parse(
                  rankProviderRequestIntentCanonicalJson(candidate)
                ) as Prisma.InputJsonValue,
                requestHash: Buffer.from(requestHash.value, "hex")
              }
            });
          storedRankProviderRequestIntent(created, current.binding);
          return created;
        },
        { isolationLevel: "ReadCommitted" }
      );
    } catch (error) {
      if (error instanceof RankProviderRequestIntentError) throw error;
      if (error instanceof RankManifestClientError) {
        throw error.retryable
          ? intentFailure("DEPENDENCY_UNAVAILABLE", true)
          : intentFailure("LOCAL_STATE_INVALID", false);
      }
      if (error instanceof TypeError) {
        throw intentFailure("LOCAL_STATE_INVALID", false);
      }
      throw intentFailure("DEPENDENCY_UNAVAILABLE", true);
    }
  }

  private async lockedSource(
    jobId: string,
    jobItemId: string
  ): Promise<RankProviderRequestIntentSource> {
    return this.prisma.$transaction(
      (transaction) =>
        lockedIntentSource(transaction, jobId, jobItemId),
      { isolationLevel: "ReadCommitted" }
    );
  }
}

export function storedRankProviderRequestIntent(
  row: RankProviderRequestIntent,
  binding: RankProviderRequestIntentBinding
): RankProviderRequestIntentV1 {
  const intent = rankProviderRequestIntent(row.requestSnapshot);
  const requestHash = rankProviderRequestIntentHash(intent);
  if (
    row.schemaVersion !== RANK_PROVIDER_REQUEST_INTENT_SCHEMA ||
    row.workspaceId !== binding.workspaceId ||
    row.projectId !== binding.projectId ||
    row.jobId !== binding.jobId ||
    row.jobItemId !== binding.jobItemId ||
    row.manifestId !== binding.manifestId ||
    row.manifestChunkIndex !== binding.manifestChunkIndex ||
    intent.workspaceId !== binding.workspaceId ||
    intent.projectId !== binding.projectId ||
    intent.actorId !== binding.actorId ||
    intent.jobId !== binding.jobId ||
    intent.jobItemId !== binding.jobItemId ||
    intent.estimateId !== binding.estimateId ||
    intent.project.domain !== binding.projectDomain ||
    intent.project.version !== binding.projectVersion ||
    canonicalizeJson(intent.execution) !==
      canonicalizeJson(binding.execution) ||
    intent.manifest.id !== binding.manifestId ||
    intent.manifest.pairCount !==
      String(binding.manifestPairCount) ||
    intent.manifestChunk.manifestId !== binding.manifestId ||
    intent.manifestChunk.chunkIndex !==
      binding.manifestChunkIndex ||
    intent.executionConnectorVersion !==
      binding.executionConnectorVersion ||
    intent.providerPolicyVersion !== binding.providerPolicyVersion ||
    !bytesEqual(
      row.requestHash,
      Buffer.from(requestHash.value, "hex")
    ) ||
    !bytesEqual(row.manifestHash, binding.manifestHash) ||
    !bytesEqual(
      row.manifestHash,
      Buffer.from(intent.manifest.manifestHash.value, "hex")
    ) ||
    !bytesEqual(
      row.manifestChunkHash,
      Buffer.from(intent.manifestChunk.chunkHash.value, "hex")
    )
  ) {
    throw intentFailure("LOCAL_STATE_INVALID", false);
  }
  return intent;
}

async function lockedIntentSource(
  transaction: Prisma.TransactionClient,
  jobId: string,
  jobItemId: string
): Promise<RankProviderRequestIntentSource> {
  const identity = await lockRankJobGraph(transaction, jobId);
  if (
    !identity ||
    !(await lockRankJobItem(transaction, identity, jobItemId))
  ) {
    throw intentFailure("ITEM_NOT_FOUND", false);
  }
  const job = await transaction.job.findUnique({
    where: { id: jobId },
    include: { rankRun: { include: { estimate: true } } }
  });
  const item = await transaction.jobItem.findUnique({
    where: { id: jobItemId }
  });
  if (!job || !item) throw intentFailure("ITEM_NOT_FOUND", false);
  const graph = job as RankIntentJobGraph;
  const source = intentSource(graph, item);
  if (
    identity.workspaceId !== source.binding.workspaceId ||
    identity.projectId !== source.binding.projectId
  ) {
    throw intentFailure("ITEM_NOT_FOUND", false);
  }
  const existing =
    await transaction.rankProviderRequestIntent.findFirst({
      where: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        jobId,
        jobItemId
      }
    });
  return { ...source, existing };
}

function intentSource(
  job: RankIntentJobGraph,
  item: JobItem
): Omit<RankProviderRequestIntentSource, "existing"> {
  const run = job.rankRun;
  const estimate = run?.estimate;
  if (
    !run ||
    !estimate ||
    job.type !== MANUAL_RANK_CHECK_JOB_TYPE ||
    job.projectId === null ||
    job.actorId === null ||
    job.provider !== "ARSENKIN" ||
    job.credentialMode !== "BYOK_API_KEY" ||
    !grantableJobState(job) ||
    job.cancelRequestedAt !== null ||
    item.workspaceId !== job.workspaceId ||
    item.projectId !== job.projectId ||
    item.jobId !== job.id ||
    item.status !== "QUEUED" ||
    item.providerRequestId !== null ||
    item.outputReference !== null ||
    item.actualCostMicro !== null ||
    item.error !== null ||
    item.attempt !== 0 ||
    item.retryAt !== null ||
    run.workspaceId !== job.workspaceId ||
    run.projectId !== job.projectId ||
    run.sealState !== "SEALED" ||
    run.manifestId === null ||
    run.manifestHashSchema !== "rank-manifest@1" ||
    run.manifestHash === null ||
    run.manifestPairCount !== estimate.keywordCount ||
    run.manifestPairCount === null ||
    run.manifestPairCount < 1 ||
    run.manifestPairCount > 1_000 ||
    run.manifestChunkCount === null ||
    run.manifestChunkCount < 1 ||
    run.manifestChunkCount > 4 ||
    run.manifestChunkSize !== 250 ||
    run.finalizationStatus !== null ||
    run.finalizedAt !== null ||
    run.cancelRequestedBy !== null ||
    estimate.id !== run.estimateId ||
    estimate.workspaceId !== job.workspaceId ||
    estimate.projectId !== job.projectId ||
    estimate.provider !== "ARSENKIN" ||
    estimate.credentialMode !== "BYOK_API_KEY" ||
    run.projectStatus !== "ACTIVE" ||
    run.projectVersion !== estimate.projectVersion
  ) {
    throw intentFailure("LOCAL_STATE_INVALID", false);
  }

  let reference: ReturnType<typeof rankJobItemReference>;
  try {
    reference = rankJobItemReference(item.inputReference);
  } catch {
    throw intentFailure("LOCAL_STATE_INVALID", false);
  }
  if (
    reference.manifestId !== run.manifestId ||
    reference.chunkIndex !== item.sequence ||
    reference.chunkIndex >= run.manifestChunkCount
  ) {
    throw intentFailure("LOCAL_STATE_INVALID", false);
  }
  const commandBinding: RankManifestCommandBinding = {
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    actorId: job.actorId,
    jobId: job.id,
    estimateId: estimate.id,
    trackingContextId: run.trackingContextId,
    projectDomain: run.projectDomain,
    projectVersion: run.projectVersion,
    pairCount: BigInt(estimate.keywordCount)
  };
  let command: ReturnType<typeof storedRankManifestCommand>;
  try {
    command = storedRankManifestCommand(
      run.manifestCommand,
      run.manifestCommandHash,
      commandBinding
    );
  } catch {
    throw intentFailure("LOCAL_STATE_INVALID", false);
  }
  const manifestHash = hashFromBytes(run.manifestHash);
  const binding: RankProviderRequestIntentBinding = {
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    actorId: job.actorId,
    jobId: job.id,
    jobItemId: item.id,
    estimateId: estimate.id,
    projectDomain: run.projectDomain,
    projectVersion: run.projectVersion,
    execution: command.execution,
    manifestId: run.manifestId,
    manifestHash: Buffer.from(run.manifestHash),
    manifestPairCount: run.manifestPairCount,
    manifestChunkIndex: reference.chunkIndex,
    executionConnectorVersion:
      ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
    providerPolicyVersion: estimate.providerPolicyVersion
  };
  return {
    binding,
    command,
    manifestHash,
    chunkInput: {
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      jobId: job.id,
      manifestId: run.manifestId,
      chunkIndex: reference.chunkIndex
    }
  };
}

function grantableJobState(job: Job): boolean {
  return (
    (job.status === "QUEUED" && job.stage === "WAITING_FOR_QUEUE") ||
    (job.status === "RUNNING" &&
      job.stage === "WAITING_EXECUTION_GRANT")
  );
}

function hashFromBytes(value: Uint8Array): RankManifestHash {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw intentFailure("LOCAL_STATE_INVALID", false);
  }
  return { algorithm: "SHA_256", value: bytes.toString("hex") };
}

function assertSameIntent(
  left: RankProviderRequestIntentV1,
  right: RankProviderRequestIntentV1
): void {
  if (canonicalizeJson(left) !== canonicalizeJson(right)) {
    throw intentFailure("LOCAL_STATE_INVALID", false);
  }
}

function bytesEqual(
  left: Uint8Array,
  right: Uint8Array
): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return (
    first.length === second.length && timingSafeEqual(first, second)
  );
}

function intentFailure(
  code: RankProviderRequestIntentErrorCode,
  retryable: boolean
): RankProviderRequestIntentError {
  return new RankProviderRequestIntentError(code, retryable);
}
