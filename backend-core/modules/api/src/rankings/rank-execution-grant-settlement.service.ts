import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  internalIssueRankExecutionGrantInput,
  internalRankExecutionGrantDecision,
  rankExecutionGrantSettlementResultSchemaVersion,
  type InternalRankExecutionGrantSettlementResultV1
} from "@seo-platform/contracts";
import {
  BillingUsageReservationExpiredError,
  BillingUsageService,
  type BillingUsageReservationResult
} from "../billing/billing-usage.service.js";
import { PrismaService } from "../database/prisma.service.js";

export interface RankExecutionGrantSettlementScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly grantId: string;
}

@Injectable()
export class RankExecutionGrantSettlementService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly usage: BillingUsageService
  ) {}

  public capture(
    scope: RankExecutionGrantSettlementScope
  ): Promise<InternalRankExecutionGrantSettlementResultV1> {
    return this.settle(scope, "CAPTURE");
  }

  public hold(
    scope: RankExecutionGrantSettlementScope
  ): Promise<InternalRankExecutionGrantSettlementResultV1> {
    return this.settle(scope, "HOLD");
  }

  public release(scope: RankExecutionGrantSettlementScope): Promise<InternalRankExecutionGrantSettlementResultV1> {
    return this.settle(scope, "RELEASE");
  }

  private settle(
    scope: RankExecutionGrantSettlementScope,
    action: "HOLD" | "CAPTURE" | "RELEASE"
  ): Promise<InternalRankExecutionGrantSettlementResultV1> {
    return this.prisma.$transaction(async (transaction) => {
      const receipt =
        await transaction.rankExecutionGrantReceipt.findUnique({
          where: { id: scope.grantId }
        });
      if (
        !receipt ||
        receipt.workspaceId !== scope.workspaceId ||
        receipt.projectId !== scope.projectId ||
        receipt.actorId !== scope.actorId ||
        receipt.decision !== "GRANTED"
      ) {
        throw new NotFoundException(
          "Rank execution grant settlement was not found"
        );
      }

      const request = internalIssueRankExecutionGrantInput(
        receipt.requestSnapshot
      );
      const decision = internalRankExecutionGrantDecision(
        receipt.responseSnapshot
      );
      if (
        request.workspaceId !== receipt.workspaceId ||
        request.projectId !== receipt.projectId ||
        request.actorId !== receipt.actorId ||
        request.jobId !== receipt.jobId ||
        request.jobItemId !== receipt.jobItemId ||
        request.executionAttempt !== receipt.executionAttempt ||
        decision.status !== "GRANTED" ||
        decision.grant.id !== receipt.id
      ) {
        throw new Error("Stored rank execution grant settlement is invalid");
      }

      if (request.credentialMode === "BYOK_API_KEY") {
        return {
          schemaVersion: rankExecutionGrantSettlementResultSchemaVersion,
          grantId: receipt.id,
          status: "NOT_APPLICABLE"
        };
      }

      const businessReference =
        `rank-provider-task:${receipt.workspaceId}:` +
        receipt.jobItemId;
      const reservation =
        await transaction.billingUsageReservation.findUnique({
          where: { businessReference }
        });
      const unitPriceMinor = BigInt(
        request.usageIntent.unitPriceMinor!
      );
      if (
        !reservation ||
        reservation.workspaceId !== receipt.workspaceId ||
        reservation.projectId !== receipt.projectId ||
        reservation.actorId !== receipt.actorId ||
        reservation.jobId !== receipt.jobId ||
        reservation.jobItemId !== receipt.jobItemId ||
        reservation.provider !== request.provider ||
        reservation.operation !== request.operation ||
        reservation.quantity !== 1 ||
        reservation.unitPriceMinor !== unitPriceMinor ||
        reservation.amountMinor !== unitPriceMinor
      ) {
        throw new Error("Stored billing usage reservation is invalid");
      }
      if (reservation.status === "RELEASED" && action !== "RELEASE") {
        throw new ConflictException(
          "Rank billing reservation has expired"
        );
      }
      let settled: BillingUsageReservationResult;
      try {
        settled = action === "HOLD"
          ? await this.usage.hold(transaction, reservation.id)
          : action === "RELEASE" ? await this.usage.release(transaction, reservation.id)
          : await this.usage.capture(transaction, reservation.id);
      } catch (error) {
        if (error instanceof BillingUsageReservationExpiredError) {
          throw new ConflictException(
            "Rank billing reservation has expired"
          );
        }
        throw error;
      }
      if (
        settled.id !== reservation.id ||
        (action === "CAPTURE"
          ? settled.status !== "CAPTURED"
          : action === "RELEASE" ? settled.status !== "RELEASED"
          : settled.status !== "RESERVED" &&
            settled.status !== "CAPTURED") ||
        settled.amountMinor !== reservation.amountMinor ||
        settled.includedAmountMinor !==
          reservation.includedAmountMinor ||
        settled.prepaidAmountMinor !== reservation.prepaidAmountMinor
      ) {
        throw new Error("Billing usage settlement result is invalid");
      }
      return {
        schemaVersion: rankExecutionGrantSettlementResultSchemaVersion,
        grantId: receipt.id,
        status: action === "RELEASE" ? "RELEASED" : action === "CAPTURE" || settled.status === "CAPTURED"
          ? "CAPTURED"
          : "RESERVED"
      };
    });
  }
}
