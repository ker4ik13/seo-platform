import { Injectable } from "@nestjs/common";
import {
  currentRankProviderPolicyVersion,
  supportedRankProviderPolicyVersions
} from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import {
  BillingEntitlementService
} from "../billing/billing-entitlement.service.js";

export const RANK_EXECUTION_GRANT_POLICY = Symbol(
  "RANK_EXECUTION_GRANT_POLICY"
);
export const CONTROLLED_BETA_RANK_POLICY_VERSION =
  currentRankProviderPolicyVersion;

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
      readonly quota: "AVAILABLE" | "UNLIMITED";
      readonly quotaReservationId: string;
    };

export interface RankExecutionGrantPolicy {
  evaluate(
    transaction: Prisma.TransactionClient,
    input: RankExecutionGrantPolicyInput
  ): Promise<RankExecutionGrantPolicyDecision>;
}

@Injectable()
export class ControlledBetaRankExecutionGrantPolicy
  implements RankExecutionGrantPolicy
{
  public constructor(
    private readonly entitlements: BillingEntitlementService
  ) {}

  public async evaluate(
    transaction: Prisma.TransactionClient,
    input: RankExecutionGrantPolicyInput
  ): Promise<RankExecutionGrantPolicyDecision> {
    if (
      !supportedRankProviderPolicyVersions.includes(
        input.policyVersion as (typeof supportedRankProviderPolicyVersions)[number]
      ) ||
      input.usageIntent.meter !== "RANK_PROVIDER_TASK" ||
      input.usageIntent.quantity !== 1
    ) {
      return {
        entitlement: "DENIED",
        quota: "NOT_AVAILABLE"
      };
    }
    const entitlement =
      await this.entitlements.rankProviderEntitlement(
        transaction,
        input.workspaceId
      );
    if (entitlement !== "ALLOWED") {
      return {
        entitlement,
        quota: "NOT_AVAILABLE"
      };
    }
    const [clock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now || Number.isNaN(clock.now.getTime())) {
      return {
        entitlement: "ALLOWED",
        quota: "NOT_AVAILABLE"
      };
    }
    const windowStartedAt = utcDay(clock.now);
    const windowEndsAt = new Date(
      windowStartedAt.getTime() + 24 * 60 * 60 * 1_000
    );
    const reservation =
      await transaction.rankExecutionQuotaReservation.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          jobId: input.jobId,
          jobItemId: input.jobItemId,
          executionAttempt: input.executionAttempt,
          meter: "RANK_PROVIDER_TASK",
          quantity: input.usageIntent.quantity,
          policyVersion: input.policyVersion,
          windowStartedAt,
          windowEndsAt,
          createdAt: clock.now
        },
        select: { id: true }
      });
    return {
      entitlement: "ALLOWED",
      quota: "UNLIMITED",
      quotaReservationId: reservation.id
    };
  }
}

function utcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate()
    )
  );
}
