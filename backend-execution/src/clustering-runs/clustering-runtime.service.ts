import { randomUUID } from "node:crypto";
import { selectIntegrationCredentialSecret } from "../integrations/platform-credential-pool.js";
import { PaidOperationRuntimeService, PaidOperationReviewError, PaidOperationUnavailableError } from "../paid-operations/paid-operation-runtime.service.js";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  internalClusteringResolveBatchLimit,
  type InternalClusteringKeyword
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "../integrations/integration-credential-refresh-scheduler.service.js";
import {
  CLUSTERING_PERSIST_COMMAND_TIMEOUT_MS,
  SeoDataClient,
  SeoDataClientError
} from "../seo-data/seo-data.client.js";
import {
  ArsenkinClusteringConnector,
  type ArsenkinClusteringFetchResult,
  type ArsenkinClusteringSubmitResult
} from "./arsenkin-clustering.connector.js";
import {
  ClusteringLeaseLostError,
  ClusteringRuntimeBrokerService,
  type ClusteringClaim
} from "./clustering-runtime-broker.service.js";

const REQUEST_TIMEOUT_MAX_MS = 10_000;
const PERSISTENCE_MARGIN_MS = 5_000;
const INTERNAL_BATCH_CONCURRENCY = 4;

@Injectable()
export class ClusteringRuntimeService {
  public constructor(
    private readonly broker: ClusteringRuntimeBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    private readonly seoData: SeoDataClient,
    private readonly arsenkin: ArsenkinClusteringConnector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    private readonly refreshScheduler?: IntegrationCredentialRefreshSchedulerService,
    @Optional() private readonly billing?: PaidOperationRuntimeService
  ) {}

  public async processBatch(
    leaseOwner: string,
    maxItems = 1
  ): Promise<{ readonly processed: number; readonly result: string }> {
    if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 4) {
      throw new TypeError("Invalid clustering runtime batch size");
    }
    let processed = 0;
    let result = "IDLE";
    for (let index = 0; index < maxItems; index += 1) {
      result = await this.processOne(leaseOwner);
      if (result === "IDLE") break;
      processed += 1;
      if (result === "RETRY_SCHEDULED" || result === "LEASE_LOST") break;
    }
    return { processed, result };
  }

  public async processOne(leaseOwner: string): Promise<string> {
    const timeoutMs = Math.min(
      this.config.integrationCredentialValidation.timeoutMs,
      REQUEST_TIMEOUT_MAX_MS
    );
    const leaseSeconds = 120;
    const claimed = await this.broker.claim(leaseOwner, leaseSeconds);
    if (!claimed) return "IDLE";
    let activeClaim = claimed;
    try {
      this.assertLease(activeClaim, timeoutMs * 2 + PERSISTENCE_MARGIN_MS);
      const currentRequestId = sharedProviderRequestId(activeClaim.items);
      if (currentRequestId?.startsWith("submitting:")) {
        const acceptedTaskId = await this.billing?.acceptedTaskId(activeClaim, activeClaim.items.map(item => item.jobItemId));
        if (acceptedTaskId) { await this.broker.defer(activeClaim, acceptedTaskId, 5); return "RETRY_SCHEDULED"; }
        await this.broker.quarantineAmbiguousSubmit(activeClaim);
        return "ACTION_REQUIRED";
      }
      const secret = selectIntegrationCredentialSecret(this.crypto.decrypt(
        activeClaim.workspaceId,
        "ARSENKIN",
        activeClaim.credentialId,
        activeClaim.encryptedCredential
      ), activeClaim.jobId, activeClaim.credentialId);
      let keywords: readonly InternalClusteringKeyword[] | undefined;
      const resolve = async (): Promise<readonly string[]> => {
        const resolved = await this.resolveKeywords(activeClaim, leaseSeconds);
        activeClaim = resolved.claim;
        keywords = resolved.keywords;
        return keywords.map(({ text }) => text);
      };
      if (!currentRequestId) await resolve();
      const providerInput = {
        searchEngine: activeClaim.searchEngine,
        regionCode: activeClaim.regionCode,
        method: activeClaim.method,
        overlapCount: activeClaim.overlapCount,
        depth: activeClaim.depth,
        excludeMainPages: activeClaim.excludeMainPages,
        stopDomains: activeClaim.stopDomains,
        frequencyTypes: activeClaim.frequencyTypes
      };
      const outcome = currentRequestId
        ? await this.arsenkin.fetchResult(
            currentRequestId,
            resolve,
            providerInput,
            secret,
            timeoutMs
          )
        : await this.runPaid(activeClaim, () => this.arsenkin.submit(
            { ...providerInput, keywords: (keywords ?? []).map(({ text }) => text) },
            secret,
            timeoutMs,
            async () => {
              this.assertLease(activeClaim, timeoutMs + PERSISTENCE_MARGIN_MS);
              const marked = await this.broker.markSubmitting(
                activeClaim,
                `submitting:${randomUUID()}`,
                leaseSeconds
              );
              if (!marked) return false;
              activeClaim = marked;
              return true;
            }
          ));
      if (
        sharedProviderRequestId(activeClaim.items)?.startsWith("submitting:") &&
        (outcome.status === "OUTCOME_UNKNOWN" || outcome.status === "RETRYABLE_FAILURE")
      ) {
        await this.broker.quarantineAmbiguousSubmit(activeClaim);
        return "ACTION_REQUIRED";
      }
      const deferred = await this.handleOutcome(activeClaim, outcome);
      if (deferred) return deferred;
      if (outcome.status !== "READY") throw new Error("Unexpected Arsenkin clustering outcome");
      if (!keywords || keywords.length !== activeClaim.items.length || outcome.result.items.length !== keywords.length) {
        throw new TypeError("Incomplete clustering result normalization");
      }
      activeClaim = await this.broker.renew(activeClaim, leaseSeconds);
      this.assertLease(
        activeClaim,
        CLUSTERING_PERSIST_COMMAND_TIMEOUT_MS + PERSISTENCE_MARGIN_MS
      );
      const proposal = await this.seoData.persistClusteringProposal({
        workspaceId: activeClaim.workspaceId,
        projectId: activeClaim.projectId,
        actorId: activeClaim.actorId,
        jobId: activeClaim.jobId,
        provider: "ARSENKIN",
        connectorVersion: this.arsenkin.version,
        parameters: {
          searchEngine: activeClaim.searchEngine,
          regionCode: activeClaim.regionCode,
          method: activeClaim.method,
          overlapCount: activeClaim.overlapCount,
          depth: activeClaim.depth,
          excludeMainPages: activeClaim.excludeMainPages,
          stopDomains: activeClaim.stopDomains,
          frequencyTypes: activeClaim.frequencyTypes,
          replaceExistingClusters: activeClaim.replaceExistingClusters
        },
        clusters: outcome.result.clusters,
        items: outcome.result.items.map((item, index) => {
          const keyword = keywords?.[index];
          if (!keyword || item.sequence !== index) {
            throw new TypeError("Clustering result order is invalid");
          }
          return {
            sequence: item.sequence,
            keywordId: keyword.id,
            keywordVersion: keyword.version,
            keywordText: keyword.text,
            ...(item.clusterSequence === undefined ? {} : { clusterSequence: item.clusterSequence }),
            ...(item.frequency ? { frequency: item.frequency } : {}),
            ...(item.exactFrequency ? { exactFrequency: item.exactFrequency } : {}),
            ...(item.aggregatorsPercent === undefined ? {} : { aggregatorsPercent: item.aggregatorsPercent }),
            ...(item.toponym ? { toponym: item.toponym } : {}),
            ...(item.geoDependent === undefined ? {} : { geoDependent: item.geoDependent })
          };
        })
      });
      await this.broker.complete(activeClaim, {
        proposalId: proposal.id,
        clusterCount: proposal.clusterCount,
        unclusteredCount: proposal.unclusteredCount
      });
      return "COMPLETED";
    } catch (error) {
      if (error instanceof PaidOperationReviewError) { await this.broker.fail(activeClaim, { code: "PAID_OPERATION_REQUIRES_REVIEW", retryable: false }).catch(() => {}); return "ACTION_REQUIRED"; }
      if (error instanceof PaidOperationUnavailableError) { await this.broker.fail(activeClaim, { code: "PAID_OPERATION_UNAVAILABLE", retryable: true, retryAfterSeconds: 30 }).catch(() => {}); return "RETRY_SCHEDULED"; }
      if (error instanceof ClusteringLeaseLostError) return "LEASE_LOST";
      if (error instanceof SeoDataClientError && !error.retryable) {
        await this.broker.fail(activeClaim, {
          code: clusteringSeoFailureCode(error.code),
          retryable: false
        });
        return "FAILED";
      }
      if (sharedProviderRequestId(activeClaim.items)?.startsWith("submitting:")) {
        await this.broker.quarantineAmbiguousSubmit(activeClaim).catch(() => undefined);
        return "ACTION_REQUIRED";
      }
      if (error instanceof TypeError) {
        await this.broker.fail(activeClaim, {
          code: "CLUSTERING_RESULT_REJECTED",
          retryable: false
        });
        return "FAILED";
      }
      await this.broker.fail(activeClaim, {
        code: "CONNECTOR_INTERNAL_ERROR",
        retryable: true,
        retryAfterSeconds: 30
      }).catch(() => undefined);
      throw error;
    } finally {
      await this.refreshScheduler
        ?.scheduleAfterProviderOperation(activeClaim.credentialId)
        .catch(() => undefined);
    }
  }

  private async runPaid<T extends object>(claim: ClusteringClaim, network: () => Promise<T>): Promise<T> {
    return this.billing ? this.billing.execute(claim, "TASK", claim.items.map(item => item.jobItemId), network) : network();
  }

  private async resolveKeywords(
    claim: ClusteringClaim,
    leaseSeconds: number
  ): Promise<{ readonly claim: ClusteringClaim; readonly keywords: readonly InternalClusteringKeyword[] }> {
    let activeClaim = claim;
    const byId = new Map<string, InternalClusteringKeyword>();
    const chunks = chunked(activeClaim.items, internalClusteringResolveBatchLimit);
    for (const window of chunked(chunks, INTERNAL_BATCH_CONCURRENCY)) {
      if (
        Date.parse(activeClaim.leaseExpiresAt) - Date.now() <
        this.config.internalCommandTimeoutMs + PERSISTENCE_MARGIN_MS
      ) {
        activeClaim = await this.broker.renew(activeClaim, leaseSeconds);
      }
      this.assertLease(
        activeClaim,
        this.config.internalCommandTimeoutMs + PERSISTENCE_MARGIN_MS
      );
      const responses = await Promise.all(window.map((items) =>
        this.seoData.resolveClusteringKeywords({
          workspaceId: activeClaim.workspaceId,
          projectId: activeClaim.projectId,
          actorId: activeClaim.actorId,
          items: items.map((item) => ({ id: item.keywordId, version: item.keywordVersion }))
        })
      ));
      for (const response of responses) {
        for (const keyword of response.items) {
          if (byId.has(keyword.id)) throw new TypeError("Duplicate clustering keyword resolution");
          byId.set(keyword.id, keyword);
        }
      }
    }
    const keywords = activeClaim.items.map((item) => byId.get(item.keywordId));
    if (keywords.some((keyword) => keyword === undefined)) {
      throw new TypeError("Incomplete clustering keyword resolution");
    }
    return { claim: activeClaim, keywords: keywords as InternalClusteringKeyword[] };
  }

  private async handleOutcome(
    claim: ClusteringClaim,
    outcome: ArsenkinClusteringSubmitResult | ArsenkinClusteringFetchResult
  ): Promise<string | undefined> {
    if (outcome.status === "ACCEPTED") {
      await this.broker.defer(claim, outcome.taskId, 5);
      return "RETRY_SCHEDULED";
    }
    if (outcome.status === "PENDING") {
      const taskId = sharedProviderRequestId(claim.items);
      if (!taskId) throw new TypeError("Clustering provider task is missing");
      if (claim.items.some(({ attempt }) => attempt >= claim.maxAttempts)) {
        await this.broker.fail(claim, { code: "PROVIDER_TIMEOUT", retryable: false });
        return "FAILED";
      }
      await this.broker.defer(claim, taskId, outcome.retryAfterSeconds);
      return "RETRY_SCHEDULED";
    }
    if (outcome.status === "RETRYABLE_FAILURE") {
      if (outcome.code === "PROVIDER_CONCURRENCY_LIMITED") {
        await this.broker.releaseForCapacity(claim, outcome.retryAfterSeconds ?? 5);
      } else {
        await this.broker.fail(claim, {
          code: outcome.code,
          retryable: true,
          ...(outcome.retryAfterSeconds ? { retryAfterSeconds: outcome.retryAfterSeconds } : {})
        });
      }
      return "RETRY_SCHEDULED";
    }
    if (outcome.status === "REJECTED" || outcome.status === "OUTCOME_UNKNOWN") {
      await this.broker.fail(claim, { code: outcome.code, retryable: false });
      return "FAILED";
    }
    return undefined;
  }

  private assertLease(claim: ClusteringClaim, requiredMs: number): void {
    if (Date.parse(claim.leaseExpiresAt) - Date.now() < requiredMs) {
      throw new ClusteringLeaseLostError();
    }
  }
}

function clusteringSeoFailureCode(code: SeoDataClientError["code"]): string {
  if (code === "CONFLICT") return "KEYWORD_VERSION_CONFLICT";
  if (code === "NOT_FOUND") return "KEYWORD_NOT_AVAILABLE";
  if (code === "INVALID_COMMAND") return "CLUSTERING_RESULT_REJECTED";
  if (code === "QUOTA_EXCEEDED") return "SEO_DATA_QUOTA_EXCEEDED";
  return "SEO_DATA_UNAVAILABLE";
}

function sharedProviderRequestId(items: ClusteringClaim["items"]): string | undefined {
  const ids = new Set(items.map(({ providerRequestId }) => providerRequestId));
  if (ids.size !== 1) throw new TypeError("Clustering run mixes provider tasks");
  return [...ids][0];
}

function chunked<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
