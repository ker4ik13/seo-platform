import { randomUUID } from "node:crypto";
import { selectIntegrationCredentialSecret } from "../integrations/platform-credential-pool.js";
import { PaidOperationRuntimeService, PaidOperationReviewError, PaidOperationUnavailableError } from "../paid-operations/paid-operation-runtime.service.js";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  arsenkinWordstatKeywordLimit,
  internalFrequencyPersistBatchLimit,
  internalFrequencySeasonalityPersistBatchLimit,
  internalFrequencyResolveBatchLimit,
  type InternalFrequencySeasonalityPoint,
  type InternalFrequencyKeyword
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  IntegrationCredentialCryptoService,
  type IntegrationCredentialSecret
} from "../integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "../integrations/integration-credential-refresh-scheduler.service.js";
import { PlatformCredentialPoolSelectionService } from "../integrations/platform-credential-pool-selection.service.js";
import { XmlStockHttpQuotaLimiter } from "../integrations/xmlstock-http-quota-limiter.js";
import { SeoDataClient, SeoDataClientError } from "../seo-data/seo-data.client.js";
import {
  ArsenkinWordstatConnector,
  type ArsenkinSeasonalityFetchResult,
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
    private readonly xmlStockQuota: XmlStockHttpQuotaLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    private readonly refreshScheduler?: IntegrationCredentialRefreshSchedulerService,
    @Optional() private readonly billing?: PaidOperationRuntimeService,
    @Optional() private readonly platformPool?: PlatformCredentialPoolSelectionService
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
      if (activeClaim.items.some((item) => item.attempt > activeClaim.maxAttempts)) {
        await this.broker.fail(activeClaim, {
          code: "PROVIDER_TIMEOUT",
          retryable: false
        });
        return "FAILED_ITEM";
      }
      if (
        activeClaim.mode === "SEASONALITY" &&
        activeClaim.provider === "ARSENKIN" &&
        (activeClaim.types.length !== 1 || activeClaim.types[0] !== "BASE")
      ) {
        await this.broker.fail(activeClaim, {
          code: "PROVIDER_INVALID_RESPONSE",
          retryable: false
        });
        return "FAILED_ITEM";
      }
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
        const acceptedTaskId = await this.billing?.acceptedTaskId(
          activeClaim,
          activeClaim.items.map(item => item.jobItemId),
          activeClaim.mode === "SEASONALITY" ? "SEASONALITY_TASK" : "TASK"
        );
        if (acceptedTaskId) { await this.broker.defer(activeClaim, acceptedTaskId, 5); return "RETRY_SCHEDULED"; }
        await this.broker.quarantineAmbiguousSubmit(activeClaim);
        return "ACTION_REQUIRED";
      }
      const decryptedSecret = this.crypto.decrypt(
        activeClaim.workspaceId,
        activeClaim.provider,
        activeClaim.credentialId,
        activeClaim.encryptedCredential
      );
      const secret = this.platformPool
        ? await this.platformPool.select(
            activeClaim.provider,
            decryptedSecret,
            activeClaim.jobId,
            activeClaim.credentialId,
            existingTaskId !== undefined
          )
        : selectIntegrationCredentialSecret(
            decryptedSecret,
            activeClaim.jobId,
            activeClaim.credentialId
          );
      const sourceMode = await this.billing?.mode(activeClaim) === "PLATFORM_PAID" ? "PLATFORM" as const : "BYOK" as const;
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
      if (activeClaim.mode === "SEASONALITY") {
        const seasonality = activeClaim.seasonality;
        if (!seasonality) {
          throw new TypeError("Seasonality collection is missing its range");
        }
        if (activeClaim.provider === "XMLSTOCK") {
          return await this.processXmlStockSeasonality(
            activeClaim,
            secret,
            seasonality,
            sourceMode,
            timeoutMs,
            leaseSeconds
          );
        }
        const taskId = sharedProviderRequestId(activeClaim.items);
        if (!taskId) await resolveKeywords();
        const outcome = taskId
          ? await this.arsenkin.fetchSeasonalityResult(
              taskId,
              resolveKeywords,
              seasonality,
              activeClaim.regionCode,
              secret,
              timeoutMs
            )
          : await this.runPaid(
              activeClaim,
              "SEASONALITY_TASK",
              () => this.arsenkin.submitSeasonality(
              {
                keywords: (keywords ?? []).map((keyword) => keyword.text),
                regionCode: activeClaim.regionCode,
                device: activeClaim.device,
                seasonality
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
            )
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
          throw new Error("Unexpected Arsenkin seasonality outcome");
        }
        if (!keywords || keywords.length !== activeClaim.items.length) {
          throw new TypeError("Incomplete seasonality keyword resolution");
        }
        const resultsByQuery = new Map(
          outcome.results.map((result) => [normalizedQuery(result.query), result.points])
        );
        const pointsByItem = new Map<string, readonly InternalFrequencySeasonalityPoint[]>();
        for (const [index, item] of activeClaim.items.entries()) {
          const keyword = keywords[index];
          const points = keyword
            ? resultsByQuery.get(normalizedQuery(keyword.text))
            : undefined;
          if (!points) {
            await this.broker.fail(activeClaim, {
              code: "PROVIDER_INVALID_RESPONSE",
              retryable: false
            });
            return "FAILED_BATCH";
          }
          pointsByItem.set(item.jobItemId, points.map((point) => ({
            type: "BASE" as const,
            granularity: seasonality.granularity,
            periodStart: point.periodStart,
            value: point.value,
            ...(point.share ? { share: point.share } : {}),
            regionCode: activeClaim.regionCode,
            device: activeClaim.device,
            provider: "ARSENKIN" as const,
            sourceMode
          })));
        }
        const observedAt = new Date().toISOString();
        activeClaim = await this.persistSeasonalityPoints(
          activeClaim,
          pointsByItem,
          observedAt,
          leaseSeconds
        );
        this.assertLease(activeClaim, FREQUENCY_PERSISTENCE_MARGIN_MS);
        await this.broker.complete(activeClaim, 1);
        return activeClaim.items.length === 1
          ? "COMPLETED_ITEM"
          : "COMPLETED_BATCH";
      }
      type Snapshot = {
        readonly type: (typeof activeClaim.types)[number];
        readonly regionCode: string;
        readonly device: typeof activeClaim.device;
        readonly period: "LAST_30_DAYS";
        readonly value: string;
        readonly provider: typeof activeClaim.provider;
        readonly sourceMode: "BYOK" | "PLATFORM";
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
          : await this.runPaid(activeClaim, "TASK", () => this.arsenkin.submit(
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
            ));
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
              sourceMode,
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
        const acquired = await this.xmlStockQuota.tryAcquire({
          credentialId: secret.rateLimitScopeId ?? activeClaim.credentialId,
          workspaceId: activeClaim.workspaceId,
          product: "WORDSTAT",
          requestCost: activeClaim.types.length,
          leaseMs:
            timeoutMs * activeClaim.types.length +
            FREQUENCY_PERSISTENCE_MARGIN_MS
        });
        if (!acquired.allowed) {
          await this.broker.releaseForProviderCapacity(
            activeClaim,
            Math.max(1, acquired.retryAfterSeconds)
          );
          return "RETRY_SCHEDULED";
        }
        try {
          const snapshots: Snapshot[] = [];
          for (const type of activeClaim.types) {
            this.assertLease(
              activeClaim,
              timeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
            );
            const result = await this.runPaid(activeClaim, type, () => this.xmlStock.collect(
              {
                keyword: keyword.text,
                type,
                regionCode: activeClaim.regionCode,
                device: activeClaim.device
              },
              secret,
              timeoutMs
            ));
            if (!result.ok) {
              if (result.code === "PROVIDER_RATE_LIMITED") {
                await this.xmlStockQuota.penalize({
                  credentialId: secret.rateLimitScopeId ?? activeClaim.credentialId,
                  product: "WORDSTAT"
                });
              }
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
              sourceMode,
              qualityFlags: []
            });
          }
          await this.xmlStockQuota.recordSuccess({
            credentialId: secret.rateLimitScopeId ?? activeClaim.credentialId,
            product: "WORDSTAT"
          });
          snapshotsByItem.set(item.jobItemId, snapshots);
        } finally {
          await this.xmlStockQuota.release(acquired);
        }
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
      if (error instanceof PaidOperationReviewError) {
        await this.broker.fail(activeClaim, { code: "PAID_OPERATION_REQUIRES_REVIEW", retryable: false }).catch(() => {});
        return "ACTION_REQUIRED";
      }
      if (error instanceof PaidOperationUnavailableError) {
        await this.broker.fail(activeClaim, { code: "PAID_OPERATION_UNAVAILABLE", retryable: true, retryAfterSeconds: 30 }).catch(() => {});
        return "RETRY_SCHEDULED";
      }
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
        ?.scheduleAfterProviderOperation(
          activeClaim.credentialId,
          activeClaim.provider
        )
        .catch(() => undefined);
    }
  }

  private async processXmlStockSeasonality(
    claim: FrequencyCollectionClaim,
    secret: IntegrationCredentialSecret,
    seasonality: NonNullable<FrequencyCollectionClaim["seasonality"]>,
    sourceMode: "BYOK" | "PLATFORM",
    timeoutMs: number,
    leaseSeconds: number
  ): Promise<string> {
    let activeClaim = claim;
    const resolved = await this.resolveKeywords(activeClaim, leaseSeconds);
    activeClaim = resolved.claim;
    const item = activeClaim.items[0];
    const keyword = resolved.keywords[0];
    if (!item || !keyword || activeClaim.items.length !== 1) {
      throw new TypeError("Invalid XMLStock seasonality claim");
    }
    const acquired = await this.xmlStockQuota.tryAcquire({
      credentialId: secret.rateLimitScopeId ?? activeClaim.credentialId,
      workspaceId: activeClaim.workspaceId,
      product: "WORDSTAT",
      requestCost: activeClaim.types.length,
      leaseMs: timeoutMs * activeClaim.types.length + FREQUENCY_PERSISTENCE_MARGIN_MS
    });
    if (!acquired.allowed) {
      await this.broker.releaseForProviderCapacity(
        activeClaim,
        Math.max(1, acquired.retryAfterSeconds)
      );
      return "RETRY_SCHEDULED";
    }
    try {
      const points: InternalFrequencySeasonalityPoint[] = [];
      for (const type of activeClaim.types) {
        this.assertLease(
          activeClaim,
          timeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
        );
        const outcome = await this.runPaid(
          activeClaim,
          `SEASONALITY_${type}`,
          () => this.xmlStock.collectSeasonality(
            {
              keyword: keyword.text,
              type,
              regionCode: activeClaim.regionCode,
              device: activeClaim.device,
              seasonality
            },
            secret,
            timeoutMs
          )
        );
        if (!outcome.ok) {
          if (outcome.code === "PROVIDER_RATE_LIMITED") {
            await this.xmlStockQuota.penalize({
              credentialId: secret.rateLimitScopeId ?? activeClaim.credentialId,
              product: "WORDSTAT"
            });
          }
          await this.broker.fail(activeClaim, outcome);
          return outcome.retryable ? "RETRY_SCHEDULED" : "FAILED_ITEM";
        }
        points.push(...outcome.points.map((point) => ({
          type,
          granularity: seasonality.granularity,
          periodStart: point.periodStart,
          value: point.value,
          ...(point.share ? { share: point.share } : {}),
          regionCode: activeClaim.regionCode,
          device: activeClaim.device,
          provider: "XMLSTOCK" as const,
          sourceMode
        })));
      }
      await this.xmlStockQuota.recordSuccess({
        credentialId: secret.rateLimitScopeId ?? activeClaim.credentialId,
        product: "WORDSTAT"
      });
      activeClaim = await this.persistSeasonalityPoints(
        activeClaim,
        new Map([[item.jobItemId, points]]),
        new Date().toISOString(),
        leaseSeconds
      );
      this.assertLease(activeClaim, FREQUENCY_PERSISTENCE_MARGIN_MS);
      await this.broker.complete(activeClaim, activeClaim.types.length);
      return "COMPLETED_ITEM";
    } finally {
      await this.xmlStockQuota.release(acquired);
    }
  }

  private async runPaid<T extends object>(claim: FrequencyCollectionClaim, part: string, network: () => Promise<T>): Promise<T> {
    return this.billing ? this.billing.execute(claim, part, claim.items.map(item => item.jobItemId), network) : network();
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
        readonly sourceMode: "BYOK" | "PLATFORM";
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

  private async persistSeasonalityPoints(
    claim: Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0],
    pointsByItem: ReadonlyMap<
      string,
      readonly InternalFrequencySeasonalityPoint[]
    >,
    observedAt: string,
    leaseSeconds: number
  ): Promise<Parameters<FrequencyCollectionRuntimeBrokerService["complete"]>[0]> {
    let activeClaim = claim;
    const chunks = chunked(
      activeClaim.items,
      internalFrequencySeasonalityPersistBatchLimit
    );
    for (const window of chunked(chunks, INTERNAL_FREQUENCY_BATCH_CONCURRENCY)) {
      activeClaim = await this.broker.renew(activeClaim, leaseSeconds);
      this.assertLease(
        activeClaim,
        this.config.internalCommandTimeoutMs + FREQUENCY_PERSISTENCE_MARGIN_MS
      );
      await Promise.all(
        window.map((items) =>
          this.seoData.persistFrequencySeasonalityBatch({
            workspaceId: activeClaim.workspaceId,
            projectId: activeClaim.projectId,
            actorId: activeClaim.actorId,
            jobId: activeClaim.jobId,
            observedAt,
            items: items.map((item) => {
              const points = pointsByItem.get(item.jobItemId);
              if (!points) {
                throw new TypeError("Incomplete seasonality normalization");
              }
              return {
                keywordId: item.keywordId,
                keywordVersion: item.keywordVersion,
                points
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
    outcome:
      | ArsenkinWordstatSubmitResult
      | ArsenkinWordstatFetchResult
      | ArsenkinSeasonalityFetchResult
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
