import type { CreateFrequencyCollectionInput } from "./frequency-collections.js";
import type { CreateAiAnswerCollectionInput } from "./ai-answer-collections.js";
import type { CreateClusteringRunInput } from "./clustering.js";
import type { CreateKeywordResearchRunInput } from "./keyword-research.js";

export const paidOperationKinds = ["FREQUENCY_COLLECTION", "AI_ANSWER_COLLECTION", "CLUSTERING_RUN", "KEYWORD_RESEARCH"] as const;
export type PaidOperationKind = typeof paidOperationKinds[number];
export type OperationEstimateCommand =
  | { readonly kind: "FREQUENCY_COLLECTION"; readonly command: CreateFrequencyCollectionInput }
  | { readonly kind: "AI_ANSWER_COLLECTION"; readonly command: CreateAiAnswerCollectionInput }
  | { readonly kind: "CLUSTERING_RUN"; readonly command: CreateClusteringRunInput }
  | { readonly kind: "KEYWORD_RESEARCH"; readonly command: CreateKeywordResearchRunInput };

export interface OperationEstimate {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly id: string | null;
  readonly kind: PaidOperationKind;
  readonly provider: "ARSENKIN" | "XMLSTOCK" | "KEYS_SO";
  readonly credentialMode: "BYOK_API_KEY" | "PLATFORM_PAID";
  readonly currency: "RUB";
  readonly maximumChargeMinor: number;
  readonly quantity: number;
  readonly affordable: boolean;
  readonly expiresAt: string;
  readonly priceBookVersion: string | null;
}

/** Core-issued admission travels only over the authenticated Core → Jobs API. */
export interface InternalPaidOperationAdmission {
  readonly quoteId: string;
  readonly jobId: string;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly credentialId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly routeId: string;
  readonly commandHash: string;
  readonly maximumProviderUnitsMilli: string;
  readonly createBefore: string;
}

export interface InternalOperationRoute {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly provider: "ARSENKIN" | "XMLSTOCK" | "KEYS_SO";
  readonly credentialMode: "BYOK_API_KEY" | "PLATFORM_PAID";
  readonly credentialId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly routeId: string;
}

/** Monetary-free execution projection. Core calculates settlement from its price snapshot. */
export interface InternalPaidOperationUsage {
  readonly quoteId: string;
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly commandHash: string;
  readonly exists: boolean;
  readonly terminal: boolean;
  readonly acceptedProviderUnitsMilli: string;
  readonly unresolvedProviderUnitsMilli: string;
  readonly lastUpdatedAt: string;
}

export interface InternalPaidOperationProof {
  readonly ticketId: string;
  readonly ticketToken: string;
  readonly quoteId: string;
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly commandHash: string;
  readonly leaseExpiresAt: string;
  readonly unitsMilli: string;
  readonly permitted: boolean;
}
