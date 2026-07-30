import {
  internalIssueRankExecutionGrantInput,
  type InternalIssueRankExecutionGrantInputV1,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
  rankExecutionEvidence,
  rankExecutionEvidenceHash,
  type RankExecutionEvidenceV1
} from "./rank-execution-evidence.js";

export interface RankExecutionGrantRequestFacts {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly projectVersion: number;
  readonly projectDomainHash: Uint8Array;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly jobVersion: number;
  readonly executionAttempt: number;
  readonly estimateId: string;
  readonly manifestId: string;
  readonly manifestHash: Uint8Array;
  readonly manifestChunkIndex: number;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly routeId: string;
  readonly credentialId: string;
  readonly credentialVersion: number;
  readonly credentialMaterialVersion: number;
  readonly credentialValidationId: string;
  readonly credentialValidationVersion: number;
  readonly credentialValidationConnectorVersion: string;
  readonly credentialVerifiedAt: Date;
  readonly estimateExecutionHash: Uint8Array;
  readonly providerPolicyVersion: string;
  readonly killSwitchVersion: string;
}

export interface BuiltRankExecutionGrantRequest {
  readonly request: InternalIssueRankExecutionGrantInputV1;
  readonly evidence: RankExecutionEvidenceV1;
  readonly evidenceHash: RankManifestHash;
}

/**
 * Reduces the locally verified private projection to the only allowlisted
 * request that may cross the Jobs → Platform API boundary. Credential IDs
 * stay inside the independently hashed evidence and secret material is not
 * representable by this input type.
 */
export function buildRankExecutionGrantRequest(
  facts: RankExecutionGrantRequestFacts
): BuiltRankExecutionGrantRequest {
  const manifestHash = hash(facts.manifestHash);
  const evidence = rankExecutionEvidence({
    schemaVersion: "rank-execution-evidence@1",
    workspaceId: facts.workspaceId,
    projectId: facts.projectId,
    jobId: facts.jobId,
    jobItemId: facts.jobItemId,
    executionAttempt: facts.executionAttempt,
    estimateId: facts.estimateId,
    manifest: {
      id: facts.manifestId,
      hash: manifestHash,
      chunkIndex: facts.manifestChunkIndex
    },
    binding: {
      id: facts.bindingId,
      version: facts.bindingVersion
    },
    route: { id: facts.routeId },
    credential: {
      id: facts.credentialId,
      version: facts.credentialVersion,
      materialVersion: facts.credentialMaterialVersion,
      validationId: facts.credentialValidationId,
      validationVersion: facts.credentialValidationVersion,
      validationConnectorVersion:
        facts.credentialValidationConnectorVersion,
      verifiedAt: timestamp(facts.credentialVerifiedAt)
    },
    estimateExecutionHash: hash(facts.estimateExecutionHash),
    executionConnectorVersion:
      ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
    providerPolicyVersion: facts.providerPolicyVersion,
    killSwitch: {
      enabled: true,
      version: facts.killSwitchVersion
    }
  });
  const evidenceHash = rankExecutionEvidenceHash(evidence);
  const request = internalIssueRankExecutionGrantInput({
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId: facts.workspaceId,
    projectId: facts.projectId,
    actorId: facts.actorId,
    membership: {
      id: facts.membershipId,
      version: facts.membershipVersion
    },
    project: {
      version: facts.projectVersion,
      domainHash: hash(facts.projectDomainHash)
    },
    jobId: facts.jobId,
    jobItemId: facts.jobItemId,
    jobVersion: facts.jobVersion,
    executionAttempt: facts.executionAttempt,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: facts.manifestId,
      hash: manifestHash,
      chunkIndex: facts.manifestChunkIndex
    },
    executionEvidenceHash: evidenceHash,
    policyVersion: facts.providerPolicyVersion,
    usageIntent: {
      meter: "RANK_PROVIDER_TASK",
      quantity: "1"
    }
  });
  return { request, evidence, evidenceHash };
}

function hash(value: Uint8Array): RankManifestHash {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw new Error("Invalid rank execution evidence hash");
  }
  return { algorithm: "SHA_256", value: bytes.toString("hex") };
}

function timestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Invalid rank execution evidence timestamp");
  }
  return value.toISOString();
}
