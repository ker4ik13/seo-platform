import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RemoteRankPollTaskV1 } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { PlatformCredentialPoolSelectionService } from "../integrations/platform-credential-pool-selection.service.js";
import {
  XmlStockHttpQuotaLimiter,
  type XmlStockHttpQuotaPermit
} from "../integrations/xmlstock-http-quota-limiter.js";
import { RankBillingSettlementClient } from "../platform-api/rank-billing-settlement.client.js";
import {
  RankConnectorRuntimeBrokerService,
  type RankConnectorPollLease
} from "../rank-runs/rank-connector-runtime-broker.service.js";
import { XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION } from "../rank-runs/rank-execution-evidence.js";
import {
  rankProviderRequestIntent,
  rankProviderRequestIntentHash,
  type RankProviderRequestIntentV1
} from "../rank-runs/rank-provider-request-intent.js";
import {
  buildXmlStockRankWireRequest,
  stageXmlStockRankResult,
  xmlStockRankHttpProduct,
  xmlStockRankPageProgress,
  xmlStockRankPageProgressHash
} from "../rank-runs/xmlstock-rank.connector.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { signRankPollTicket, verifyRankPollTicket } from "./worker-task-ticket.js";

const REMOTE_POLL_LEASE_SECONDS = 90;
const REMOTE_PROVIDER_TIMEOUT_MS = 10_000;
const MAX_CLAIMS_PER_POLL = 32;
const MAX_CANDIDATES_PER_POLL = 64;
// The combined /worker/v1/claim endpoint may call this twice. Each pass must
// leave time to serialize and return every leased task before the agent's
// 30-second HTTP timeout, even when one physical key is saturated.
const CLAIM_BATCH_BUDGET_MS = 5_000;

@Injectable()
export class WorkerRankGatewayService {
  public constructor(
    private readonly nodes: WorkerNodeService,
    private readonly broker: RankConnectorRuntimeBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    private readonly platformPool: PlatformCredentialPoolSelectionService,
    private readonly quota: XmlStockHttpQuotaLimiter,
    private readonly settlement: RankBillingSettlementClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async claimBatch(
    nodeId: string,
    nodeToken: string,
    availableSlots: number,
    budgetMs = CLAIM_BATCH_BUDGET_MS
  ): Promise<readonly RemoteRankPollTaskV1[]> {
    this.assertEnabled();
    if (!Number.isSafeInteger(budgetMs) || budgetMs < 0 || budgetMs > CLAIM_BATCH_BUDGET_MS) {
      throw new TypeError("Invalid rank claim time budget");
    }
    const capacity = await this.nodes.authorizeForWork(nodeId, nodeToken, "RANK");
    const count = Math.min(availableSlots, capacity.httpSlots, MAX_CLAIMS_PER_POLL);
    const tasks: RemoteRankPollTaskV1[] = [];
    const deadline = Date.now() + budgetMs;
    for (let index = 0; index < MAX_CANDIDATES_PER_POLL && tasks.length < count; index += 1) {
      if (Date.now() >= deadline) break;
      let task: RemoteRankPollTaskV1 | "DEFERRED" | null;
      try {
        task = await this.claimOne(nodeId, capacity.httpSlots);
      } catch (error) {
        if (tasks.length === 0) throw error;
        break;
      }
      if (!task) break;
      // A saturated key/product must not block other keys or search engines.
      // The broker's bounded candidate window excludes the deferred execution.
      if (task === "DEFERRED") continue;
      tasks.push(task);
    }
    return tasks;
  }

  private async claimOne(
    nodeId: string,
    httpSlots: number
  ): Promise<RemoteRankPollTaskV1 | "DEFERRED" | null> {
    const claim = await this.broker.claimPoll(
      `remote:${nodeId}:${randomUUID()}`,
      REMOTE_POLL_LEASE_SECONDS,
      XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
    );
    if (!claim) return null;
    if (claim.provider !== "XMLSTOCK" || claim.providerProgressInvalid) {
      await this.broker.completePoll(claim, {
        outcome: "REJECTED", errorCode: "INVALID_PROVIDER_RESPONSE"
      });
      return "DEFERRED";
    }
    let permit: Extract<XmlStockHttpQuotaPermit, { readonly allowed: true }> | undefined;
    try {
      const decrypted = this.crypto.decrypt(
        claim.workspaceId, claim.provider, claim.credentialId,
        claim.encryptedCredential
      );
      const secret = await this.platformPool.select(
        claim.provider, decrypted, claim.executionId, claim.credentialId, true
      );
      if (!secret.rateLimitScopeId) throw new Error("Physical key scope is unavailable");
      const wireRequest = buildXmlStockRankWireRequest(claim.request);
      const product = xmlStockRankHttpProduct(wireRequest);
      const acquired = await this.quota.tryAcquire({
        credentialId: secret.rateLimitScopeId,
        workspaceId: claim.workspaceId,
        product,
        leaseMs: 75_000,
        nodeId,
        nodeConcurrency: httpSlots
      });
      if (!acquired.allowed) {
        await this.broker.deferPollForProviderCapacity(
          claim, Math.max(1, acquired.retryAfterSeconds)
        );
        return "DEFERRED";
      }
      permit = acquired;
      const settlement = claim.providerProgress === undefined
        ? await this.broker.readBillingSettlement(claim)
        : undefined;
      if (settlement?.required) {
        await this.settlement.hold(
          settlementCommand(claim.request, settlement.grantId),
          settlementContext(claim.executionId, "hold")
        );
      }
      const ticket = signRankPollTicket(this.config, {
        nodeId,
        workspaceId: claim.workspaceId,
        executionId: claim.executionId,
        providerTaskId: claim.providerTaskId,
        leaseOwner: claim.leaseOwner,
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
        executionVersion: claim.executionVersion,
        leaseExpiresAt: claim.leaseExpiresAt,
        requestHash: rankProviderRequestIntentHash(claim.request).value,
        physicalKeyScopeId: secret.rateLimitScopeId,
        product,
        quotaMember: acquired.member,
        settlementGrantId: settlement?.required ? settlement.grantId : null
      });
      return {
        schemaVersion: "worker-rank-poll-task@1",
        ticket,
        provider: "XMLSTOCK",
        providerTaskId: claim.providerTaskId,
        requestSnapshot: claim.request,
        ...(claim.providerProgress ? { providerProgress: claim.providerProgress } : {}),
        secret: {
          apiKey: secret.apiKey,
          ...(secret.accountIdentifier ? { accountIdentifier: secret.accountIdentifier } : {})
        },
        ...(this.config.xmlStockSoftId ? { softId: this.config.xmlStockSoftId } : {}),
        timeoutMs: REMOTE_PROVIDER_TIMEOUT_MS
      };
    } catch (error) {
      if (permit) await this.quota.release(permit);
      await this.broker.completePoll(claim, {
        outcome: "RETRYABLE_FAILURE",
        errorCode: "PROVIDER_UNAVAILABLE",
        retryAfterSeconds: 5
      }).catch(() => undefined);
      throw error;
    }
  }

  public async complete(
    nodeId: string,
    nodeToken: string,
    ticketValue: unknown,
    requestValue: unknown,
    outcomeValue: unknown
  ): Promise<{ readonly status: string }> {
    this.assertEnabled();
    await this.nodes.authenticateForCompletion(nodeId, nodeToken);
    const ticket = verifyRankPollTicket(this.config, ticketValue, nodeId);
    const lease: RankConnectorPollLease = {
      workspaceId: ticket.workspaceId,
      executionId: ticket.executionId,
      leaseOwner: ticket.leaseOwner,
      leaseToken: ticket.leaseToken,
      leaseGeneration: ticket.leaseGeneration,
      executionVersion: ticket.executionVersion
    };
    const permit: Extract<XmlStockHttpQuotaPermit, { readonly allowed: true }> = {
      allowed: true,
      credentialId: ticket.physicalKeyScopeId,
      workspaceId: ticket.workspaceId,
      product: ticket.product,
      member: ticket.quotaMember,
      nodeId
    };
    try {
      const request = rankProviderRequestIntent(requestValue);
      if (request.workspaceId !== ticket.workspaceId ||
        rankProviderRequestIntentHash(request).value !== ticket.requestHash) {
        throw new Error("Worker task request changed");
      }
      let outcome: RemoteOutcome;
      try {
        outcome = remoteOutcome(outcomeValue);
      } catch {
        await this.broker.completePoll(lease, {
          outcome: "REJECTED", errorCode: "INVALID_PROVIDER_RESPONSE"
        });
        throw new TypeError("Invalid remote rank outcome");
      }
      // Validate and hash provider data before any billable capture.
      let staged: ReturnType<typeof stageXmlStockRankResult> | undefined;
      let progress: ReturnType<typeof xmlStockRankPageProgress> | undefined;
      try {
        if (outcome.status === "READY") {
          staged = stageXmlStockRankResult(
            outcome.value, ticket.providerTaskId, request,
            new Date().toISOString()
          );
        } else if (outcome.status === "CHECKPOINTED") {
          progress = xmlStockRankPageProgress(outcome.progress);
          if (xmlStockRankPageProgressHash(progress).value !== outcome.hash) {
            throw new TypeError("Remote checkpoint hash mismatch");
          }
        }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        await this.broker.completePoll(lease, {
          outcome: "REJECTED", errorCode: "INVALID_PROVIDER_RESPONSE"
        });
        throw new TypeError("Invalid remote rank evidence");
      }
      if (outcome.status === "RETRYABLE_FAILURE" &&
        outcome.code === "PROVIDER_RATE_LIMITED") {
        await this.quota.penalize({
          credentialId: ticket.physicalKeyScopeId,
          product: ticket.product,
          ...(outcome.retryAfterSeconds === undefined ? {} : {
            retryAfterSeconds: outcome.retryAfterSeconds
          })
        });
      } else if (
        outcome.status !== "RETRYABLE_FAILURE" ||
        outcome.code !== "PROVIDER_UNAVAILABLE"
      ) {
        await this.quota.recordSuccess({
          credentialId: ticket.physicalKeyScopeId,
          product: ticket.product
        });
      }
      const billable = outcome.status === "READY" || outcome.status === "CHECKPOINTED";
      if (billable && ticket.settlementGrantId) {
        await this.settlement.capture(
          settlementCommand(request, ticket.settlementGrantId),
          settlementContext(ticket.executionId, "capture")
        );
      }
      if (outcome.status === "REJECTED" && ticket.settlementGrantId &&
        outcome.code !== "INVALID_PROVIDER_RESPONSE") {
        await this.settlement.release(
          settlementCommand(request, ticket.settlementGrantId),
          settlementContext(ticket.executionId, "release")
        );
      }
      switch (outcome.status) {
        case "READY": {
          if (!staged) throw new TypeError("Remote rank result was not staged");
          const completed = await this.broker.completePoll(lease, {
            outcome: "READY",
            observedAt: staged.snapshot.observedAt,
            snapshot: staged.snapshot,
            hash: Buffer.from(staged.hash.value, "hex")
          });
          return { status: completed.status };
        }
        case "CHECKPOINTED": {
          if (!progress) throw new TypeError("Remote rank progress was not validated");
          const completed = await this.broker.completePoll(lease, {
            outcome: "CHECKPOINTED",
            progress,
            hash: Buffer.from(xmlStockRankPageProgressHash(progress).value, "hex")
          });
          return { status: completed.status };
        }
        case "PENDING": {
          const completed = await this.broker.completePoll(lease, {
            outcome: "PENDING",
            retryAfterSeconds: outcome.retryAfterSeconds
          });
          return { status: completed.status };
        }
        case "RETRYABLE_FAILURE": {
          const completed = await this.broker.completePoll(lease, {
            outcome: "RETRYABLE_FAILURE",
            errorCode: outcome.code,
            ...(outcome.retryAfterSeconds === undefined ? {} : {
              retryAfterSeconds: outcome.retryAfterSeconds
            })
          });
          return { status: completed.status };
        }
        case "REJECTED": {
          const completed = await this.broker.completePoll(lease, {
            outcome: "REJECTED", errorCode: outcome.code
          });
          return { status: completed.status };
        }
      }
    } finally {
      await this.quota.release(permit);
    }
  }

  public assertEnabled(): void {
    if (!this.config.workerGatewayEnabled ||
      this.config.integrationCredentials.role !== "BOTH") {
      throw new ServiceUnavailableException("Remote execution is disabled");
    }
  }
}

function settlementCommand(
  source: RankProviderRequestIntentV1,
  grantId: string
) {
  return {
    workspaceId: source.workspaceId,
    projectId: source.projectId,
    actorId: source.actorId,
    grantId
  };
}

function settlementContext(executionId: string, action: "hold" | "capture" | "release") {
  return {
    requestId: `rank-remote-${action}-${executionId}`,
    idempotencyKey: `rank-remote-${action}-${executionId}`
  };
}

type RemoteOutcome =
  | { readonly status: "READY"; readonly value: unknown }
  | { readonly status: "CHECKPOINTED"; readonly progress: unknown; readonly hash: string }
  | { readonly status: "PENDING"; readonly retryAfterSeconds: number }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE"; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: "INVALID_CREDENTIAL" | "PROVIDER_PLAN_OR_REQUEST_REJECTED" | "INVALID_PROVIDER_RESPONSE" };

function remoteOutcome(value: unknown): RemoteOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid remote rank outcome");
  }
  const input = value as Record<string, unknown>;
  const expected = input.status === "READY" ? ["status", "value"]
    : input.status === "CHECKPOINTED" ? ["status", "progress", "hash"]
    : input.status === "PENDING" ? ["status", "retryAfterSeconds"]
    : input.status === "RETRYABLE_FAILURE" ? ["status", "code", ...(input.retryAfterSeconds === undefined ? [] : ["retryAfterSeconds"])]
    : input.status === "REJECTED" ? ["status", "code"] : [];
  if (expected.length === 0 || Object.keys(input).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(input, key))) {
    throw new TypeError("Invalid remote rank outcome");
  }
  if (input.status === "READY") return { status: "READY", value: input.value };
  if (input.status === "CHECKPOINTED") {
    const hash = input.hash;
    if (typeof hash !== "object" || hash === null || Array.isArray(hash)) {
      throw new TypeError("Invalid remote rank hash");
    }
    const parsed = hash as Record<string, unknown>;
    if (Object.keys(parsed).length !== 2 || parsed.algorithm !== "SHA_256" ||
      typeof parsed.value !== "string" || !/^[a-f0-9]{64}$/u.test(parsed.value)) {
      throw new TypeError("Invalid remote rank hash");
    }
    return { status: "CHECKPOINTED", progress: input.progress, hash: parsed.value };
  }
  if (input.status === "PENDING" && boundedRetry(input.retryAfterSeconds)) {
    return { status: "PENDING", retryAfterSeconds: input.retryAfterSeconds };
  }
  if (input.status === "RETRYABLE_FAILURE" &&
    (input.code === "PROVIDER_RATE_LIMITED" || input.code === "PROVIDER_UNAVAILABLE") &&
    (input.retryAfterSeconds === undefined || boundedRetry(input.retryAfterSeconds))) {
    return {
      status: "RETRYABLE_FAILURE",
      code: input.code,
      ...(input.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: input.retryAfterSeconds })
    };
  }
  if (input.status === "REJECTED" &&
    (input.code === "INVALID_CREDENTIAL" ||
      input.code === "PROVIDER_PLAN_OR_REQUEST_REJECTED" ||
      input.code === "INVALID_PROVIDER_RESPONSE")) {
    return { status: "REJECTED", code: input.code };
  }
  throw new TypeError("Invalid remote rank outcome");
}

function boundedRetry(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0 && value <= 3600;
}
