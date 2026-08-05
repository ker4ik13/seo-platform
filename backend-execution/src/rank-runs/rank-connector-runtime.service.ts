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
import {
  XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
} from "./rank-execution-evidence.js";
import {
  XmlStockRankConnector,
  buildXmlStockRankWireRequest,
  stageXmlStockRankResult,
  xmlStockRankWireRequestHash
} from "./xmlstock-rank.connector.js";

export const ARSENKIN_RANK_CONNECTOR = Symbol(
  "ARSENKIN_RANK_CONNECTOR"
);
export const XMLSTOCK_RANK_CONNECTOR = Symbol("XMLSTOCK_RANK_CONNECTOR");

const RANK_PROVIDER_REQUEST_TIMEOUT_MAX_MS = 10_000;
const RANK_CONNECTOR_LEASE_MARGIN_MS = 3_000;
const RANK_CONNECTOR_SUBMIT_LEASE_MAX_SECONDS = 25;

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
  private nextProvider: "ARSENKIN" | "XMLSTOCK" = "ARSENKIN";

  public constructor(
    private readonly broker: RankConnectorRuntimeBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    @Inject(ARSENKIN_RANK_CONNECTOR)
    private readonly connector: ArsenkinRankConnector,
    @Inject(XMLSTOCK_RANK_CONNECTOR)
    private readonly xmlStockConnector: XmlStockRankConnector,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * Performs one submit/status request, plus one result request only after a
   * finished status. The BullMQ queue shared with credential validation uses
   * a conservative per-job limit because a finished poll costs two requests.
   */
  public async processOne(
    leaseOwner: string
  ): Promise<RankConnectorRuntimeOutcome> {
    try {
      if (this.config.rankExecution.submitEnabled) {
        const submit = await this.claimSubmit(leaseOwner);
        if (submit) {
          return await this.submit(submit);
        }
      }

      const poll = await this.claimPoll(leaseOwner);
      if (poll) {
        return await this.poll(poll);
      }
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
    const built = claim.provider === "XMLSTOCK"
      ? (() => {
          const request = buildXmlStockRankWireRequest(requestIntent);
          return {
            request,
            hash: xmlStockRankWireRequestHash(request).value
          };
        })()
      : (() => {
          const request = buildArsenkinRankWireRequest(requestIntent);
          return {
            request,
            hash: arsenkinRankWireRequestHash(request).value
          };
        })();
    const wireRequestHash = Buffer.from(built.hash, "hex");
    this.assertNetworkBudget(claim.leaseExpiresAt, 1);
    const secret = this.crypto.decrypt(
      claim.workspaceId,
      claim.provider,
      claim.credentialId,
      claim.encryptedCredential
    );
    const permit = await this.broker.authorizeSubmit(
      claim,
      connectorVersion(claim.provider)
    );
    const outcome = claim.provider === "XMLSTOCK"
      ? await this.xmlStockConnector.submit(
          requestIntent,
          secret,
          this.providerRequestTimeoutMs()
        )
      : await this.connector.submit(
          requestIntent,
          secret,
          this.providerRequestTimeoutMs()
        );
    await this.broker.completeSubmit(
      claim,
      permit,
      outcome,
      built.request,
      wireRequestHash
    );
    return outcome.status === "ACCEPTED"
      ? "SUBMITTED"
      : "SUBMIT_TERMINAL";
  }

  private async poll(
    claim: RankConnectorPollClaim
  ): Promise<RankConnectorRuntimeOutcome> {
    this.assertNetworkBudget(
      claim.leaseExpiresAt,
      claim.provider === "XMLSTOCK" &&
        claim.request.execution.searchEngine === "GOOGLE"
        ? Math.ceil(claim.request.execution.depth / 10)
        : 2
    );
    const secret = this.crypto.decrypt(
      claim.workspaceId,
      claim.provider,
      claim.credentialId,
      claim.encryptedCredential
    );
    const outcome = claim.provider === "XMLSTOCK"
      ? await this.xmlStockConnector.fetchResult(
          claim.providerTaskId,
          secret,
          this.providerRequestTimeoutMs(),
          claim.request
        )
      : await this.connector.fetchResult(
          claim.providerTaskId,
          secret,
          this.providerRequestTimeoutMs()
        );
    switch (outcome.status) {
      case "PENDING":
        await this.broker.completePoll(claim, {
          outcome: "PENDING",
          ...(claim.provider === "XMLSTOCK"
            ? { retryAfterSeconds: 25 }
            : {})
        });
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
        let staged:
          | ReturnType<typeof stageArsenkinRankResult>
          | ReturnType<typeof stageXmlStockRankResult>;
        try {
          staged = claim.provider === "XMLSTOCK"
            ? stageXmlStockRankResult(
                outcome.value,
                claim.providerTaskId,
                claim.request,
                observedAt
              )
            : stageArsenkinRankResult(
                outcome.value,
                claim.providerTaskId,
                claim.request,
                observedAt
              );
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          await this.broker.completePoll(claim, {
            outcome: "REJECTED",
            errorCode: "INVALID_PROVIDER_RESPONSE"
          });
          return "POLL_TERMINAL";
        }
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

  private submitLeaseSeconds(): number {
    // The authoritative execution grant is intentionally short lived. Submit
    // performs one provider request, so reserving the much longer Google
    // pagination lease here can make an otherwise valid grant unclaimable.
    return Math.min(
      RANK_CONNECTOR_SUBMIT_LEASE_MAX_SECONDS,
      Math.max(
        5,
        Math.ceil(
          (this.providerRequestTimeoutMs() + RANK_CONNECTOR_LEASE_MARGIN_MS) /
            1_000
        )
      )
    );
  }

  private pollLeaseSeconds(): number {
    // Google XML can require up to ten sequential page requests for Top-100.
    // Keep one lease long enough for the largest documented request while the
    // broker still fences stale workers by generation and token.
    const worstCasePollMs =
      this.providerRequestTimeoutMs() * 10 +
      RANK_CONNECTOR_LEASE_MARGIN_MS;
    return Math.min(
      120,
      Math.max(
        5,
        Math.ceil(worstCasePollMs / 1_000)
      )
    );
  }

  private providerRequestTimeoutMs(): number {
    return Math.min(
      this.config.integrationCredentialValidation.timeoutMs,
      RANK_PROVIDER_REQUEST_TIMEOUT_MAX_MS
    );
  }

  private assertNetworkBudget(
    leaseExpiresAt: string,
    maximumRequestCount: number
  ): void {
    const remainingMs = Date.parse(leaseExpiresAt) - Date.now();
    if (
      !Number.isFinite(remainingMs) ||
      remainingMs <
        this.providerRequestTimeoutMs() * maximumRequestCount +
          1_000
    ) {
      throw new RankConnectorLeaseLostError();
    }
  }

  private async claimSubmit(
    leaseOwner: string
  ): Promise<RankConnectorSubmitClaim | undefined> {
    const [first, second] = this.providerOrder();
    return (
      (await this.broker.claimSubmit(
        leaseOwner,
        this.submitLeaseSeconds(),
        connectorVersion(first)
      )) ??
      this.broker.claimSubmit(
        leaseOwner,
        this.submitLeaseSeconds(),
        connectorVersion(second)
      )
    );
  }

  private async claimPoll(
    leaseOwner: string
  ): Promise<RankConnectorPollClaim | undefined> {
    const [first, second] = this.providerOrder();
    return (
      (await this.broker.claimPoll(
        leaseOwner,
        this.pollLeaseSeconds(),
        connectorVersion(first)
      )) ??
      this.broker.claimPoll(
        leaseOwner,
        this.pollLeaseSeconds(),
        connectorVersion(second)
      )
    );
  }

  private providerOrder(): readonly ["ARSENKIN" | "XMLSTOCK", "ARSENKIN" | "XMLSTOCK"] {
    const first = this.nextProvider;
    const second = first === "ARSENKIN" ? "XMLSTOCK" : "ARSENKIN";
    this.nextProvider = second;
    return [first, second];
  }
}

function connectorVersion(provider: "ARSENKIN" | "XMLSTOCK"): string {
  return provider === "XMLSTOCK"
    ? XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
    : ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION;
}
