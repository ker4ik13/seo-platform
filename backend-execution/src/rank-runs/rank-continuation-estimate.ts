import { Prisma } from "../generated/prisma/client.js";
import type { RankEstimate } from "../generated/prisma/client.js";
import {
  RANK_ESTIMATE_TTL_MILLISECONDS,
  providerMinimumRequests,
  type CredentialSnapshot,
  type VerifiedRankEstimate
} from "../rank-estimates/rank-estimate.service.js";
import {
  rankEstimateExecutionHash,
  rankEstimateExecutionJson
} from "../rank-estimates/rank-estimate-execution.js";
import { rankEstimateSnapshotJson } from "../rank-estimates/rank-estimate-snapshot.js";

interface ContinuationEstimateIdentity {
  readonly id: string;
  readonly actorId: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly requestHash: Uint8Array;
  readonly calculatedAt: Date;
  readonly pairCount: number;
  readonly credential: CredentialSnapshot;
  readonly scopeHash: Uint8Array;
}

export async function createContinuationEstimate(
  transaction: Prisma.TransactionClient,
  parent: RankEstimate,
  parentSummary: VerifiedRankEstimate["summary"],
  execution: NonNullable<VerifiedRankEstimate["execution"]>,
  identity: ContinuationEstimateIdentity
): Promise<RankEstimate> {
  const expiresAt = new Date(
    identity.calculatedAt.getTime() + RANK_ESTIMATE_TTL_MILLISECONDS
  );
  const verifiedAt = identity.credential.verifiedAt;
  if (
    !verifiedAt ||
    identity.scopeHash.byteLength !== 32 ||
    !Number.isSafeInteger(identity.pairCount) ||
    identity.pairCount < 1 ||
    identity.pairCount > parent.keywordCount
  ) {
    throw new Error("Rank continuation estimate input is incomplete");
  }
  if (parent.provider !== "ARSENKIN" && parent.provider !== "XMLSTOCK") {
    throw new Error("Rank continuation provider is unsupported");
  }
  const providerTaskCount =
    parent.provider === "XMLSTOCK" ? identity.pairCount : 1;
  const minimumRequests = providerMinimumRequests(
    parent.provider,
    execution,
    providerTaskCount
  );
  const summary = continuationEstimateSummary(parentSummary, {
    id: identity.id,
    calculatedAt: identity.calculatedAt,
    expiresAt,
    credentialVerifiedAt: verifiedAt,
    scopeHash: identity.scopeHash,
    pairCount: identity.pairCount,
    providerTaskCount,
    minimumRequestCount:
      minimumRequests.submit + minimumRequests.check + minimumRequests.get
  });
  return transaction.rankEstimate.create({
    data: {
      id: identity.id,
      workspaceId: parent.workspaceId,
      projectId: parent.projectId,
      actorId: identity.actorId,
      trackingContextId: parent.trackingContextId,
      idempotencyScope: identity.idempotencyScope,
      idempotencyKey: identity.idempotencyKey,
      requestHash: databaseBytes(identity.requestHash),
      projectVersion: parent.projectVersion,
      projectDomainHash: databaseBytes(parent.projectDomainHash),
      contextVersion: parent.contextVersion,
      configurationVersion: parent.configurationVersion,
      configurationHash: databaseBytes(parent.configurationHash),
      semanticScopeHash: nullableDatabaseBytes(parent.semanticScopeHash),
      scopeHash: databaseBytes(identity.scopeHash),
      bindingId: identity.credential.bindingId ?? null,
      bindingVersion: identity.credential.bindingVersion ?? null,
      routeId: identity.credential.routeId ?? null,
      credentialId: identity.credential.credentialId ?? null,
      credentialStatus: identity.credential.credentialStatus ?? null,
      credentialVersion: identity.credential.credentialVersion ?? null,
      credentialMaterialVersion:
        identity.credential.credentialMaterialVersion ?? null,
      credentialDeletedAt: identity.credential.credentialDeletedAt ?? null,
      credentialValidationId: identity.credential.validationId ?? null,
      credentialValidationVersion:
        identity.credential.validationVersion ?? null,
      credentialValidationConnectorVersion:
        identity.credential.validationConnectorVersion ?? null,
      credentialValidationFinishedAt:
        identity.credential.validationFinishedAt ?? null,
      credentialVerifiedAt: verifiedAt,
      provider: parent.provider,
      credentialMode: parent.credentialMode,
      providerPolicyVersion: parent.providerPolicyVersion,
      keywordCount: identity.pairCount,
      providerTaskCount,
      minimumSubmitRequestCount: minimumRequests.submit,
      minimumCheckRequestCount: minimumRequests.check,
      minimumGetRequestCount: minimumRequests.get,
      blockers: summary.blockers as unknown as Prisma.InputJsonValue,
      responseSnapshot: rankEstimateSnapshotJson(summary),
      executionSnapshot: rankEstimateExecutionJson(execution),
      executionSnapshotHash: databaseBytes(
        rankEstimateExecutionHash(execution)
      ),
      calculatedAt: identity.calculatedAt,
      expiresAt
    }
  });
}

function continuationEstimateSummary(
  parent: VerifiedRankEstimate["summary"],
  identity: Pick<RankEstimate, "id" | "calculatedAt" | "expiresAt"> & {
    readonly credentialVerifiedAt: Date;
    readonly scopeHash: Uint8Array;
    readonly pairCount: number;
    readonly providerTaskCount: number;
    readonly minimumRequestCount: number;
  }
): VerifiedRankEstimate["summary"] {
  return {
    ...parent,
    id: identity.id,
    scope: {
      ...parent.scope,
      keywordCount: String(identity.pairCount),
      pairCount: String(identity.pairCount),
      scopeHash: {
        availability: "AVAILABLE",
        algorithm: "SHA_256",
        value: Buffer.from(identity.scopeHash).toString("hex")
      }
    },
    workload: {
      ...parent.workload,
      taskCount: String(identity.providerTaskCount),
      minimumRequestCount: String(identity.minimumRequestCount)
    },
    credentialFreshness: {
      status: "FRESH",
      verifiedAt: identity.credentialVerifiedAt.toISOString()
    },
    calculatedAt: identity.calculatedAt.toISOString(),
    expiresAt: identity.expiresAt.toISOString()
  };
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function nullableDatabaseBytes(
  value: Uint8Array | null
): Uint8Array<ArrayBuffer> | null {
  return value === null ? null : databaseBytes(value);
}
