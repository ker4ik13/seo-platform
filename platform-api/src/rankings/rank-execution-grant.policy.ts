import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";

export const RANK_EXECUTION_GRANT_POLICY = Symbol(
  "RANK_EXECUTION_GRANT_POLICY"
);

export interface RankExecutionGrantPolicyInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly executionAttempt: number;
  readonly policyVersion: string;
  readonly usageIntent: {
    readonly meter: "RANK_PROVIDER_TASK";
    readonly quantity: 1;
  };
}

export type RankExecutionGrantPolicyDecision =
  | {
      readonly entitlement: "DENIED" | "NOT_AVAILABLE";
      readonly quota: "NOT_AVAILABLE";
      readonly quotaReservationId?: never;
    }
  | {
      readonly entitlement: "ALLOWED";
      readonly quota: "EXHAUSTED" | "NOT_AVAILABLE";
      readonly quotaReservationId?: never;
    }
  | {
      readonly entitlement: "ALLOWED";
      readonly quota: "AVAILABLE";
      readonly quotaReservationId: string;
    };

export interface RankExecutionGrantPolicy {
  evaluate(
    transaction: Prisma.TransactionClient,
    input: RankExecutionGrantPolicyInput
  ): Promise<RankExecutionGrantPolicyDecision>;
}

/**
 * Production stays fail-closed until a versioned entitlement/quota ledger is
 * implemented. Replacing this provider is a separate billing release gate;
 * no environment flag can turn a denial into a grant.
 */
@Injectable()
export class FailClosedRankExecutionGrantPolicy
  implements RankExecutionGrantPolicy
{
  public async evaluate(): Promise<RankExecutionGrantPolicyDecision> {
    return {
      entitlement: "NOT_AVAILABLE",
      quota: "NOT_AVAILABLE"
    };
  }
}
