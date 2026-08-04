import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  arsenkinWordstatKeywordLimit,
  internalFrequencyPersistBatchLimit,
  internalFrequencyResolveBatchLimit,
  type InternalFrequencyKeyword
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "../integrations/integration-credential-refresh-scheduler.service.js";
import { SeoDataClient, SeoDataClientError } from "../seo-data/seo-data.client.js";
import {
  ArsenkinWordstatConnector,
  type ArsenkinWordstatFetchResult,
  type ArsenkinWordstatSubmitResult
} from "./arsenkin-wordstat.connector.js";
import {
  FrequencyCollectionLeaseLostError,
  FrequencyCollectionRuntimeBrokerService,
  type FrequencyCollectionClaim
} from "./frequency-collection-runtime-broker.service.js";
import {
  WordstatQueryError,
  XmlStockWordstatConnector
} from "./xmlstock-wordstat.connector.js";

const FREQUENCY_PROVIDER_REQUEST_TIMEOUT_MAX_MS = 10_000;
const FREQUENCY_PERSISTENCE_MARGIN_MS = 5_000;
const INTERNAL_FREQUENCY_BATCH_CONCURRENCY = 4;
const SUBMIT_MARKER_PATTERN =
  /^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

@Injectable()
export class FrequencyCollectionRuntimeService {
  public constructor(
    private readonly broker: FrequencyCollectionRuntimeBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    private readonly seoData: SeoDataClient,
    private readonly xmlStock: XmlStockWordstatConnector,
    private readonly arsenkin: ArsenkinWordstatConnector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    private readonly refreshScheduler?: IntegrationCredentialRefreshSchedulerService
  ) {}

  public async processBatch(
    leaseOwner: string,
    maxItems = 10
  ): Promise<{ readonly processed: number; readonly result: string }> {
    if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 25) {
      throw new TypeError("Invalid frequency collection batch size");
    }
    let result = "IDLE";
    let processed = 0;
    for (let index = 0; index < maxItems; index += 1) {
      result = await this.processOne(leaseOwner);
      if (result === "IDLE") break;
      processed += 1;
      if (result === "RETRY_SCHEDULED" || result === "LEASE_LOST") break;
    }
    return { processed, result };
  }

  public async processOne(leaseOwner: string): Promise<string> {
    const timeoutMs = this.providerRequestTimeoutMs();
    const leaseSeconds = this.leaseSeconds();
    const claimed = await this.broker.claim(
      leaseOwner,
      leaseSeconds,
      arsenkinWordstatKeywordLimit
    );
    if (!claimed) return "IDLE";
    let activeClaim: FrequencyCollectionClaim = claimed;
    try {
      this.assertLease(
        activeClaim,
        this.requiredExecutionBudgetMs(activeClaim)
      );
      const existingTaskId = sharedProviderRequestId(activeClaim.items);
      if (
        activeClaim.provider === "ARSENKIN" &&
        existingTaskId !== undefined &&
        isSubmitMarker(existingTaskId)
      ) {
        await this.broker.quarantineAmbiguousSubmit(activeClaim);
        return "ACTION_REQUIRED";
      }
      const secret = this.crypto.decrypt(
        activeClaim.workspaceId,
        activeClaim.provider,
        activeClaim.credentialId,
        activeClaim.encryptedCredential
      );
      let keywords: readonly InternalFrequencyKeyword[] | undefined;
      const resolveKeywords = async (): Promise<readonly string[]> => {
        const resolved = await this.resolveKeywords(activeClaim, leaseSeconds);
        activeClaim = resolved.claim;
        keywords = resolved.keywords;
        this.assertLease(
          activeClaim,
          this.config.internalCommandTimeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
        );
        return keywords.map((keyword) => keyword.text);
      };
      type Snapshot = {
        readonly type: (typeof activeClaim.types)[number];
        readonly regionCode: string;
        readonly device: typeof activeClaim.device;
        readonly period: "LAST_30_DAYS";
        readonly value: string;
        readonly provider: typeof activeClaim.provider;
        readonly sourceMode: "BYOK";
        readonly qualityFlags: readonly [];
      };
      const snapshotsByItem = new Map<string, readonly Snapshot[]>();
      if (activeClaim.provider === "ARSENKIN") {
        const taskId = sharedProviderRequestId(activeClaim.items);
        if (!taskId) await resolveKeywords();
        const outcome = taskId
          ? await this.arsenkin.fetchResult(
              taskId,
              resolveKeywords,
              activeClaim.types,
              activeClaim.regionCode,
              secret,
              timeoutMs
            )
          : await this.arsenkin.submit(
              {
                keywords: (keywords ?? []).map((keyword) => keyword.text),
                types: activeClaim.types,
                regionCode: activeClaim.regionCode,
                device: activeClaim.device
              },
              secret,
              timeoutMs,
              async () => {
                this.assertLease(
                  activeClaim,
                  timeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
                );
                const marker = `submitting:${randomUUID()}`;
                const marked = await this.broker.markSubmitting(
                  activeClaim,
                  marker,
                  leaseSeconds
                );
                if (!marked) return false;
                activeClaim = marked;
                return true;
              }
            );
        if (
          isSubmitMarker(sharedProviderRequestId(activeClaim.items)) &&
          (outcome.status === "OUTCOME_UNKNOWN" ||
            outcome.status === "RETRYABLE_FAILURE")
        ) {
          await this.broker.quarantineAmbiguousSubmit(activeClaim);
          return "ACTION_REQUIRED";
        }
        const deferred = await this.handleArsenkinOutcome(activeClaim, outcome);
        if (deferred) return deferred;
        if (outcome.status !== "READY") {
          throw new Error("Unexpected Arsenkin Wordstat outcome");
        }
        if (!keywords || keywords.length !== activeClaim.items.length) {
          throw new TypeError("Incomplete frequency keyword resolution");
        }
        const valuesByQuery = new Map(
          outcome.results.map((result) => [normalizedQuery(result.query), result.values])
        );
        for (const [index, item] of activeClaim.items.entries()) {
          const keyword = keywords[index];
          const values = keyword
            ? valuesByQuery.get(normalizedQuery(keyword.text))
            : undefined;
          if (!values) {
            await this.broker.fail(activeClaim, {
              code: "PROVIDER_INVALID_RESPONSE",
              retryable: false
            });
            return "FAILED_BATCH";
          }
          snapshotsByItem.set(
            item.jobItemId,
            activeClaim.types.map((type) => ({
              type,
              regionCode: activeClaim.regionCode,
              device: activeClaim.device,
              period: "LAST_30_DAYS",
              value: values[type],
              provider: "ARSENKIN",
              sourceMode: "BYOK",
              qualityFlags: []
            }))
          );
        }
      } else {
        await resolveKeywords();
        const item = activeClaim.items[0];
        const keyword = keywords?.[0];
        if (!item || !keyword || activeClaim.items.length !== 1) {
          throw new TypeError("Invalid XMLStock frequency claim");
        }
        const snapshots: Snapshot[] = [];
        for (const type of activeClaim.types) {
          this.assertLease(
            activeClaim,
            timeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
          );
          const result = await this.xmlStock.collect(
            {
              keyword: keyword.text,
              type,
              regionCode: activeClaim.regionCode,
              device: activeClaim.device
            },
            secret,
            timeoutMs
          );
          if (!result.ok) {
            await this.broker.fail(activeClaim, result);
            return result.retryable ? "RETRY_SCHEDULED" : "FAILED_ITEM";
          }
          snapshots.push({
            type,
            regionCode: activeClaim.regionCode,
            device: activeClaim.device,
            period: "LAST_30_DAYS",
            value: result.value,
            provider: "XMLSTOCK",
            sourceMode: "BYOK",
            qualityFlags: []
          });
        }
        snapshotsByItem.set(item.jobItemId, snapshots);
      }
      const observedAt = new Date().toISOString();
      activeClaim = await this.persistSnapshots(
        activeClaim,
        snapshotsByItem,
        observedAt,
        leaseSeconds
      );
      this.assertLease(activeClaim, FREQUENCY_PERSISTENCE_MARGIN_MS);
      await this.broker.complete(activeClaim, activeClaim.types.length);
      return activeClaim.items.length === 1
        ? "COMPLETED_ITEM"
        : "COMPLETED_BATCH";
    } catch (error) {
      if (error instanceof FrequencyCollectionLeaseLostError) return "LEASE_LOST";
      if (error instanceof WordstatQueryError) {
        await this.broker.fail(activeClaim, {
          code: "INVALID_WORDSTAT_QUERY",
          retryable: false
        });
        return "FAILED_ITEM";
      }
      if (error instanceof SeoDataClientError && !error.retryable) {
        await this.broker.fail(activeClaim, {
          code: error.code === "CONFLICT" ? "KEYWORD_VERSION_CONFLICT" : "KEYWORD_NOT_AVAILABLE",
          retryable: false
        });
        return "FAILED_ITEM";
      }
      if (
        activeClaim.provider === "ARSENKIN" &&
        isSubmitMarker(sharedProviderRequestId(activeClaim.items))
      ) {
        await this.broker
          .quarantineAmbiguousSubmit(activeClaim)
          .catch(() => undefined);
        return "ACTION_REQUIRED";
      }
      await this.broker
        .fail(activeClaim, {
          code: "CONNECTOR_INTERNAL_ERROR",
          retryable: true,
          retryAfterSeconds: 30
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await this.refreshScheduler
        ?.scheduleAfterProviderOperation(activeClaim.credentialId)
        .catch(() => undefined);
    }
  }

  private async resolveKeywords(
    claim: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0],
    leaseSeconds: number
  ): Promise<{
    readonly claim: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0];
    readonly keywords: readonly InternalFrequencyKeyword[];
  }> {
    let activeClaim = claim;
    const byId = new Map<string, InternalFrequencyKeyword>();
    const chunks = chunked(activeClaim.items, internalFrequencyResolveBatchLimit);
    for (const window of chunked(chunks, INTERNAL_FREQUENCY_BATCH_CONCURRENCY)) {
      activeClaim = await this.broker.renew(activeClaim, leaseSeconds);
      this.assertLease(
        activeClaim,
        this.config.internalCommandTimeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
      );
      const responses = await Promise.all(
        window.map((items) =>
          this.seoData.resolveFrequencyKeywords({
            workspaceId: activeClaim.workspaceId,
            projectId: activeClaim.projectId,
            actorId: activeClaim.actorId,
            items: items.map((item) => ({
              id: item.keywordId,
              version: item.keywordVersion
            }))
          })
        )
      );
      for (const response of responses) {
        for (const keyword of response.items) {
          if (byId.has(keyword.id)) {
            throw new TypeError("Duplicate frequency keyword resolution");
          }
          byId.set(keyword.id, keyword);
        }
      }
    }
    const keywords = activeClaim.items.map((item) => {
      const keyword = byId.get(item.keywordId);
      if (!keyword || keyword.version !== item.keywordVersion) {
        throw new TypeError("Incomplete frequency keyword resolution");
      }
      return keyword;
    });
    return { claim: activeClaim, keywords };
  }

  private async persistSnapshots(
    claim: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0],
    snapshotsByItem: ReadonlyMap<
      string,
      readonly {
        readonly type: (typeof claim.types)[number];
        readonly regionCode: string;
        readonly device: typeof claim.device;
        readonly period: "LAST_30_DAYS";
        readonly value: string;
        readonly provider: typeof claim.provider;
        readonly sourceMode: "BYOK";
        readonly qualityFlags: readonly [];
      }[]
    >,
    observedAt: string,
    leaseSeconds: number
  ): Promise<Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0]> {
    let activeClaim = claim;
    const chunks = chunked(activeClaim.items, internalFrequencyPersistBatchLimit);
    for (const window of chunked(chunks, INTERNAL_FREQUENCY_BATCH_CONCURRENCY)) {
      activeClaim = await this.broker.renew(activeClaim, leaseSeconds);
      this.assertLease(
        activeClaim,
        this.config.internalCommandTimeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
      );
      await Promise.all(
        window.map((items) =>
          this.seoData.persistFrequencySnapshotBatch({
            workspaceId: activeClaim.workspaceId,
            projectId: activeClaim.projectId,
            actorId: activeClaim.actorId,
            jobId: activeClaim.jobId,
            observedAt,
            items: items.map((item) => {
              const snapshots = snapshotsByItem.get(item.jobItemId);
              if (!snapshots || snapshots.length !== activeClaim.types.length) {
                throw new TypeError("Incomplete frequency batch normalization");
              }
              return {
                keywordId: item.keywordId,
                keywordVersion: item.keywordVersion,
                snapshots
              };
            })
          })
        )
      );
    }
    return activeClaim;
  }

  private async handleArsenkinOutcome(
    claim: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0],
    outcome: ArsenkinWordstatSubmitResult | ArsenkinWordstatFetchResult
  ): Promise<string | undefined> {
    if (outcome.status === "ACCEPTED") {
      await this.broker.defer(claim, outcome.taskId, 5);
      return "RETRY_SCHEDULED";
    }
    if (outcome.status === "PENDING") {
      const taskId = sharedProviderRequestId(claim.items);
      if (!taskId) throw new Error("Arsenkin polling task is missing");
      if (claim.items.some((item) => item.attempt >= claim.maxAttempts)) {
        await this.broker.fail(claim, {
          code: "PROVIDER_TIMEOUT",
          retryable: false
        });
        return "FAILED_ITEM";
      }
      await this.broker.defer(claim, taskId, outcome.retryAfterSeconds);
      return "RETRY_SCHEDULED";
    }
    if (outcome.status === "RETRYABLE_FAILURE") {
      if (outcome.code === "PROVIDER_CONCURRENCY_LIMITED") {
        await this.broker.releaseForProviderCapacity(
          claim,
          outcome.retryAfterSeconds ?? 5
        );
        return "RETRY_SCHEDULED";
      }
      await this.broker.fail(claim, {
        code: outcome.code,
        retryable: true,
        ...(outcome.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: outcome.retryAfterSeconds })
      });
      return "RETRY_SCHEDULED";
    }
    if (outcome.status === "REJECTED" || outcome.status === "OUTCOME_UNKNOWN") {
      await this.broker.fail(claim, {
        code: outcome.code,
        retryable: false
      });
      return "FAILED_ITEM";
    }
    return undefined;
  }

  private providerRequestTimeoutMs(): number {
    return Math.min(
      this.config.integrationCredentialValidation.timeoutMs,
      FREQUENCY_PROVIDER_REQUEST_TIMEOUT_MAX_MS
    );
  }

  private leaseSeconds(): number {
    // SEO Data commands are allowed to use the configured 60-second timeout.
    // Keep enough fenced time for one command plus the persistence margin;
    // otherwise the default production config loses every lease immediately
    // after a successful renewal, before the provider submit can start.
    return 120;
  }

  private requiredExecutionBudgetMs(
    claim: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0]
  ): number {
    const maximumRequestCount =
      claim.provider === "ARSENKIN" ? 2 : claim.types.length;
    return (
      this.providerRequestTimeoutMs() * maximumRequestCount +
      FREQUENCY_PERSISTENCE_MARGIN_MS
    );
  }

  private assertLease(
    claim: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0],
    requiredBudgetMs: number
  ): void {
    if (
      !Number.isFinite(requiredBudgetMs) ||
      requiredBudgetMs < 0 ||
      Date.parse(claim.leaseExpiresAt) - Date.now() < requiredBudgetMs
    ) {
      throw new FrequencyCollectionLeaseLostError();
    }
  }
}

function sharedProviderRequestId(
  items: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0]["items"]
): string | undefined {
  const values = new Set(items.map((item) => item.providerRequestId));
  if (values.size !== 1) {
    throw new TypeError("Frequency batch mixes provider tasks");
  }
  return [...values][0];
}

function normalizedQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isSubmitMarker(value: string | undefined): boolean {
  return value !== undefined && SUBMIT_MARKER_PATTERN.test(value);
}

function chunked<T>(
  values: readonly T[],
  size: number
): readonly (readonly T[])[] {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new TypeError("Invalid frequency batch chunk size");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
