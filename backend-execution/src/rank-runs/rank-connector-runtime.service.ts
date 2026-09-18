import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { RankBillingSettlementClient } from "../platform-api/rank-billing-settlement.client.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { selectIntegrationCredentialSecret } from "../integrations/platform-credential-pool.js";
import { PlatformCredentialPoolSelectionService } from "../integrations/platform-credential-pool-selection.service.js";
import {
  XmlStockHttpQuotaLimiter,
  type XmlStockHttpQuotaPermit,
  type XmlStockHttpProduct
} from "../integrations/xmlstock-http-quota-limiter.js";
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
import {
  ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
  XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
} from "./rank-execution-evidence.js";
import {
  XmlStockRankConnector,
  buildXmlStockRankWireRequest,
  stageXmlStockRankResult,
  xmlStockRankHttpProduct,
  xmlStockRankUsesQuota,
  xmlStockRankWireRequestHash
} from "./xmlstock-rank.connector.js";
import type { RankProviderRequestIntentV1 } from "./rank-provider-request-intent.js";

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
  | "PROVIDER_CAPACITY_DELAYED"
  | "SUBMITTED"
  | "SUBMIT_TERMINAL"
  | "POLL_PENDING"
  | "POLL_CHECKPOINTED"
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
    private readonly xmlStockQuota: XmlStockHttpQuotaLimiter,
    private readonly settlements: RankBillingSettlementClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly platformPool?: PlatformCredentialPoolSelectionService
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
    const settlement = await this.broker.readBillingSettlement(claim);
    const decryptedSecret = this.crypto.decrypt(
        claim.workspaceId,
        claim.provider,
        claim.credentialId,
        claim.encryptedCredential
    );
    const secret = this.platformPool
      ? await this.platformPool.select(
          claim.provider,
          decryptedSecret,
          claim.executionId,
          claim.credentialId
        )
      : selectIntegrationCredentialSecret(
          decryptedSecret,
          claim.executionId,
          claim.credentialId
        );
    const providerCredentialScopeId = secret.rateLimitScopeId!;
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
    const settlesOnAcceptedSubmit =
      claim.provider === "ARSENKIN" ||
      ("delayed" in built.request && built.request.delayed);
    this.assertNetworkBudget(
      claim.leaseExpiresAt,
      1,
      settlement.required && settlesOnAcceptedSubmit
        ? this.settlementTimeoutMs() * 2
        : 0
    );
    let quotaPermit: Extract<
      XmlStockHttpQuotaPermit,
      { readonly allowed: true }
    > | undefined;
    let quotaProduct: XmlStockHttpProduct | undefined;
    if (claim.provider === "XMLSTOCK") {
      const request = buildXmlStockRankWireRequest(requestIntent);
      if (request.delayed && xmlStockRankUsesQuota(request)) {
        quotaProduct = xmlStockRankHttpProduct(request);
        const acquired = await this.xmlStockQuota.tryAcquire({
          credentialId: providerCredentialScopeId,
          product: quotaProduct,
          leaseMs:
            this.providerRequestTimeoutMs() + RANK_CONNECTOR_LEASE_MARGIN_MS
        });
        if (!acquired.allowed) return "PROVIDER_CAPACITY_DELAYED";
        quotaPermit = acquired;
      }
    }
    try {
      // Persist the money hold BEFORE any possibly paid provider request.
      // A crash or an ambiguous response must not expire this reservation.
      if (settlement.required && settlesOnAcceptedSubmit) {
        await this.settleUsage("HOLD", settlement, requestIntent, claim.executionId);
      }
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
      if (quotaProduct) {
        await this.observeXmlStockQuota(
          providerCredentialScopeId,
          quotaProduct,
          outcome
        );
      }
      if (
        settlement.required &&
        outcome.status === "ACCEPTED" &&
        settlesOnAcceptedSubmit
      ) {
        await this.settleUsage(
          "CAPTURE",
          settlement,
          requestIntent,
          claim.executionId
        );
      }
      if (settlement.required && settlesOnAcceptedSubmit && outcome.status === "REJECTED" && outcome.code !== "INVALID_PROVIDER_RESPONSE") {
        await this.settleUsage("RELEASE", settlement, requestIntent, claim.executionId);
      }
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
    } finally {
      if (quotaPermit) await this.xmlStockQuota.release(quotaPermit);
    }
  }

  private async poll(
    claim: RankConnectorPollClaim
  ): Promise<RankConnectorRuntimeOutcome> {
    if (claim.provider === "XMLSTOCK" && claim.providerProgressInvalid) {
      await this.broker.completePoll(claim, {
        outcome: "REJECTED",
        errorCode: "INVALID_PROVIDER_RESPONSE"
      });
      return "POLL_TERMINAL";
    }
    const xmlStockRequest = claim.provider === "XMLSTOCK"
      ? buildXmlStockRankWireRequest(claim.request)
      : undefined;
    const lateSettlement =
      xmlStockRequest &&
      !xmlStockRequest.delayed &&
      claim.providerProgress === undefined
        ? await this.broker.readBillingSettlement(claim)
        : undefined;
    this.assertNetworkBudget(
      claim.leaseExpiresAt,
      claim.provider === "XMLSTOCK" ? 1 : 2,
      lateSettlement?.required
        ? this.settlementTimeoutMs() * 2
        : 0
    );
    const decryptedSecret = this.crypto.decrypt(
        claim.workspaceId,
        claim.provider,
        claim.credentialId,
        claim.encryptedCredential
    );
    const secret = this.platformPool
      ? await this.platformPool.select(
          claim.provider,
          decryptedSecret,
          claim.executionId,
          claim.credentialId,
          true
        )
      : selectIntegrationCredentialSecret(
          decryptedSecret,
          claim.executionId,
          claim.credentialId
        );
    const providerCredentialScopeId = secret.rateLimitScopeId!;
    let outcome:
      | Awaited<ReturnType<XmlStockRankConnector["fetchResult"]>>
      | Awaited<ReturnType<ArsenkinRankConnector["fetchResult"]>>;
    if (claim.provider === "XMLSTOCK") {
      const request = xmlStockRequest!;
      if (!xmlStockRankUsesQuota(request)) {
        if (lateSettlement?.required) {
          await this.settleUsage(
            "HOLD",
            lateSettlement,
            claim.request,
            claim.executionId
          );
        }
        outcome = await this.xmlStockConnector.fetchResult(
          claim.providerTaskId,
          secret,
          this.providerRequestTimeoutMs(),
          claim.request,
          claim.providerProgress
        );
      } else {
        const product = xmlStockRankHttpProduct(request);
        const acquired = await this.xmlStockQuota.tryAcquire({
          credentialId: providerCredentialScopeId,
          product,
          leaseMs:
            this.providerRequestTimeoutMs() + RANK_CONNECTOR_LEASE_MARGIN_MS
        });
        if (!acquired.allowed) {
          await this.broker.deferPollForProviderCapacity(
            claim,
            Math.max(5, acquired.retryAfterSeconds)
          );
          return "PROVIDER_CAPACITY_DELAYED";
        }
        try {
          if (lateSettlement?.required) {
            await this.settleUsage(
              "HOLD",
              lateSettlement,
              claim.request,
              claim.executionId
            );
          }
          outcome = await this.xmlStockConnector.fetchResult(
            claim.providerTaskId,
            secret,
            this.providerRequestTimeoutMs(),
            claim.request,
            claim.providerProgress
          );
          await this.observeXmlStockQuota(
            providerCredentialScopeId,
            product,
            outcome
          );
        } finally {
          await this.xmlStockQuota.release(acquired);
        }
      }
    } else {
      outcome = await this.connector.fetchResult(
        claim.providerTaskId,
        secret,
        this.providerRequestTimeoutMs()
      );
    }
    switch (outcome.status) {
      case "CHECKPOINTED":
        if (lateSettlement?.required) {
          await this.settleUsage(
            "CAPTURE",
            lateSettlement,
            claim.request,
            claim.executionId
          );
        }
        await this.broker.completePoll(claim, {
          outcome: "CHECKPOINTED",
          progress: outcome.progress,
          hash: Buffer.from(outcome.hash.value, "hex")
        });
        return "POLL_CHECKPOINTED";
      case "PENDING":
        await this.broker.completePoll(claim, {
          outcome: "PENDING",
          ...("retryAfterSeconds" in outcome
            ? { retryAfterSeconds: outcome.retryAfterSeconds }
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
        if (lateSettlement?.required && outcome.code !== "INVALID_PROVIDER_RESPONSE") {
          await this.settleUsage("RELEASE", lateSettlement, claim.request, claim.executionId);
        }
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
        if (lateSettlement?.required) {
          await this.settleUsage(
            "CAPTURE",
            lateSettlement,
            claim.request,
            claim.executionId
          );
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

  private settleUsage(
    action: "HOLD" | "CAPTURE" | "RELEASE",
    settlement: {
      readonly grantId: string;
      readonly required: boolean;
    },
    request: RankProviderRequestIntentV1,
    executionId: string
  ): Promise<unknown> {
    const command = {
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      actorId: request.actorId,
      grantId: settlement.grantId
    };
    const context = {
      requestId: `rank-settle-${executionId}`,
      idempotencyKey:
        `rank-settlement:${settlement.grantId}:` +
        action.toLowerCase()
    };
    return action === "HOLD"
      ? this.settlements.hold(command, context)
      : action === "RELEASE" ? this.settlements.release(command, context)
      : this.settlements.capture(command, context);
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
            1_000 +
            this.settlementTimeoutMs() * 2 / 1_000
        )
      )
    );
  }

  private pollLeaseSeconds(): number {
    // XMLStock Live persists one paid page per poll. One provider request is
    // therefore enough for every connector, while Arsenkin may perform a
    // status request followed by one result request.
    const worstCasePollMs =
      this.providerRequestTimeoutMs() * 2 +
      RANK_CONNECTOR_LEASE_MARGIN_MS +
      this.settlementTimeoutMs() * 2;
    return Math.min(
      120,
      Math.max(
        5,
        Math.ceil(worstCasePollMs / 1_000)
      )
    );
  }

  private settlementTimeoutMs(): number {
    return Math.min(this.config.platformApiCommandTimeoutMs, 5_000);
  }

  private providerRequestTimeoutMs(): number {
    return Math.min(
      this.config.integrationCredentialValidation.timeoutMs,
      RANK_PROVIDER_REQUEST_TIMEOUT_MAX_MS
    );
  }

  private async observeXmlStockQuota(
    credentialId: string,
    product: XmlStockHttpProduct,
    outcome: {
      readonly status: string;
      readonly code?: string;
      readonly retryAfterSeconds?: number;
    }
  ): Promise<void> {
    if (
      outcome.status === "RETRYABLE_FAILURE" &&
      outcome.code === "PROVIDER_RATE_LIMITED"
    ) {
      await this.xmlStockQuota.penalize({
        credentialId,
        product,
        ...(outcome.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: outcome.retryAfterSeconds })
      });
      return;
    }
    if (
      outcome.status !== "OUTCOME_UNKNOWN" &&
      !(
        outcome.status === "RETRYABLE_FAILURE" &&
        outcome.code === "PROVIDER_UNAVAILABLE"
      )
    ) {
      await this.xmlStockQuota.recordSuccess({ credentialId, product });
    }
  }

  private assertNetworkBudget(
    leaseExpiresAt: string,
    maximumRequestCount: number,
    additionalTimeoutMs = 0
  ): void {
    const remainingMs = Date.parse(leaseExpiresAt) - Date.now();
    if (
      !Number.isFinite(remainingMs) ||
      remainingMs <
        this.providerRequestTimeoutMs() * maximumRequestCount +
          additionalTimeoutMs +
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
