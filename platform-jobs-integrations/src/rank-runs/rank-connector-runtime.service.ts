import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import {
  ArsenkinRankConnector,
  arsenkinRankWireRequestHash,
  buildArsenkinRankWireRequest,
  stageArsenkinRankResult
} from "./arsenkin-rank.connector.js";
import {
  RankConnectorLeaseLostError,
  RankConnectorRuntimeBrokerService,
  type RankConnectorPollClaim,
  type RankConnectorSubmitClaim
} from "./rank-connector-runtime-broker.service.js";
import { ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION } from "./rank-execution-evidence.js";

export const ARSENKIN_RANK_CONNECTOR = Symbol(
  "ARSENKIN_RANK_CONNECTOR"
);

export type RankConnectorRuntimeOutcome =
  | "DISABLED"
  | "IDLE"
  | "LEASE_LOST"
  | "SUBMITTED"
  | "SUBMIT_TERMINAL"
  | "POLL_PENDING"
  | "RESULT_STAGED"
  | "POLL_TERMINAL";

@Injectable()
export class RankConnectorRuntimeService {
  public constructor(
    private readonly broker: RankConnectorRuntimeBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    @Inject(ARSENKIN_RANK_CONNECTOR)
    private readonly connector: ArsenkinRankConnector,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * Performs at most one provider HTTP request. The BullMQ queue shared with
   * credential validation supplies the provider-wide rate limit.
   */
  public async processOne(
    leaseOwner: string
  ): Promise<RankConnectorRuntimeOutcome> {
    try {
      if (this.config.rankExecution.submitEnabled) {
        const submit = await this.broker.claimSubmit(
          leaseOwner,
          this.leaseSeconds(),
          ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION
        );
        if (submit) return this.submit(submit);
      }

      const poll = await this.broker.claimPoll(
        leaseOwner,
        this.leaseSeconds(),
        ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION
      );
      if (poll) return this.poll(poll);
      return this.config.rankExecution.submitEnabled ? "IDLE" : "DISABLED";
    } catch (error) {
      if (error instanceof RankConnectorLeaseLostError) {
        return "LEASE_LOST";
      }
      throw error;
    }
  }

  private async submit(
    claim: RankConnectorSubmitClaim
  ): Promise<RankConnectorRuntimeOutcome> {
    const requestIntent = await this.broker.readSubmitRequest(claim);
    const wireRequest = buildArsenkinRankWireRequest(requestIntent);
    const wireRequestHash = Buffer.from(
      arsenkinRankWireRequestHash(wireRequest).value,
      "hex"
    );
    this.assertNetworkBudget(claim.leaseExpiresAt);
    const secret = this.crypto.decrypt(
      claim.workspaceId,
      "ARSENKIN",
      claim.credentialId,
      claim.encryptedCredential
    );
    const permit = await this.broker.authorizeSubmit(
      claim,
      ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION
    );
    const outcome = await this.connector.submit(
      requestIntent,
      secret,
      this.config.integrationCredentialValidation.timeoutMs
    );
    await this.broker.completeSubmit(
      claim,
      permit,
      outcome,
      wireRequest,
      wireRequestHash
    );
    return outcome.status === "ACCEPTED"
      ? "SUBMITTED"
      : "SUBMIT_TERMINAL";
  }

  private async poll(
    claim: RankConnectorPollClaim
  ): Promise<RankConnectorRuntimeOutcome> {
    this.assertNetworkBudget(claim.leaseExpiresAt);
    const secret = this.crypto.decrypt(
      claim.workspaceId,
      "ARSENKIN",
      claim.credentialId,
      claim.encryptedCredential
    );
    const outcome = await this.connector.fetchResult(
      claim.providerTaskId,
      secret,
      this.config.integrationCredentialValidation.timeoutMs
    );
    switch (outcome.status) {
      case "PENDING":
        await this.broker.completePoll(claim, { outcome: "PENDING" });
        return "POLL_PENDING";
      case "RETRYABLE_FAILURE":
        await this.broker.completePoll(claim, {
          outcome: "RETRYABLE_FAILURE",
          errorCode: outcome.code,
          ...(outcome.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: outcome.retryAfterSeconds })
        });
        return "POLL_PENDING";
      case "REJECTED":
        await this.broker.completePoll(claim, {
          outcome: "REJECTED",
          errorCode: outcome.code
        });
        return "POLL_TERMINAL";
      case "READY": {
        const observedAt = new Date().toISOString();
        const staged = stageArsenkinRankResult(
          outcome.value,
          claim.providerTaskId,
          claim.request,
          observedAt
        );
        await this.broker.completePoll(claim, {
          outcome: "READY",
          observedAt,
          snapshot: staged.snapshot,
          hash: Buffer.from(staged.hash.value, "hex")
        });
        return "RESULT_STAGED";
      }
    }
  }

  private leaseSeconds(): number {
    return Math.min(
      25,
      Math.max(
        5,
        Math.ceil(
          (this.config.integrationCredentialValidation.timeoutMs + 2_000) /
            1_000
        )
      )
    );
  }

  private assertNetworkBudget(leaseExpiresAt: string): void {
    const remainingMs = Date.parse(leaseExpiresAt) - Date.now();
    if (
      !Number.isFinite(remainingMs) ||
      remainingMs <
        this.config.integrationCredentialValidation.timeoutMs + 1_000
    ) {
      throw new RankConnectorLeaseLostError();
    }
  }
}
