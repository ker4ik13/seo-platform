import { createHash, randomUUID } from "node:crypto";
import { selectIntegrationCredentialSecret } from "../integrations/platform-credential-pool.js";
import { PaidOperationRuntimeService, PaidOperationReviewError, PaidOperationUnavailableError, type PaidOperationClaimScope } from "../paid-operations/paid-operation-runtime.service.js";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "../integrations/integration-credential-refresh-scheduler.service.js";
import { PlatformCredentialPoolSelectionService } from "../integrations/platform-credential-pool-selection.service.js";
import { XmlStockHttpQuotaLimiter, type XmlStockHttpQuotaPermit } from "../integrations/xmlstock-http-quota-limiter.js";
import { XmlStockWordstatConnector, type XmlStockWordstatExpansionRow } from "../frequency-collections/xmlstock-wordstat.connector.js";
import {
  ARSENKIN_WORDSTAT_EXPANSION_CONNECTOR,
  KEYS_SO_KEYWORD_RESEARCH_CONNECTOR,
  type ArsenkinWordstatExpansionConnector,
  type KeysSoKeywordResearchConnector
} from "./keyword-research.tokens.js";
import {
  KeywordResearchLeaseLostError,
  KeywordResearchRuntimeBrokerService,
  type KeywordResearchClaim
} from "./keyword-research-runtime-broker.service.js";

type XmlStockResearchClaim = Extract<KeywordResearchClaim, { readonly source: "XMLSTOCK_WORDSTAT" }>;

type XmlStockSeedCollectionOutcome =
  | { readonly state: "CAPACITY" | "UNKNOWN" }
  | { readonly state: "REJECTED"; readonly errorCode: string }
  | { readonly state: "ACCEPTED"; readonly rows: readonly XmlStockWordstatExpansionRow[]; readonly responseHash: Buffer };

function knownUnchargedXmlStockSeedFailure(code: string): boolean {
  return [
    "PROVIDER_RATE_LIMITED", "PROVIDER_CONCURRENCY_LIMITED",
    "INVALID_CREDENTIAL", "PROVIDER_AUTH_FAILED", "PROVIDER_REQUEST_REJECTED",
    "PROVIDER_INSUFFICIENT_BALANCE", "PROVIDER_QUOTA_EXCEEDED"
  ].includes(code);
}

function retryableXmlStockSeedFailure(code: string | undefined): boolean {
  return code === "PROVIDER_RATE_LIMITED" || code === "PROVIDER_CONCURRENCY_LIMITED";
}

@Injectable()
export class KeywordResearchRuntimeService {
  public constructor(
    private readonly broker: KeywordResearchRuntimeBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    @Inject(KEYS_SO_KEYWORD_RESEARCH_CONNECTOR)
    private readonly keysSo: KeysSoKeywordResearchConnector,
    @Inject(ARSENKIN_WORDSTAT_EXPANSION_CONNECTOR)
    private readonly wordstat: ArsenkinWordstatExpansionConnector,
    private readonly xmlStockWordstat: XmlStockWordstatConnector,
    private readonly xmlStockQuota: XmlStockHttpQuotaLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    private readonly refreshScheduler?: IntegrationCredentialRefreshSchedulerService,
    @Optional() private readonly billing?: PaidOperationRuntimeService,
    @Optional() private readonly platformPool?: PlatformCredentialPoolSelectionService
  ) {}

  public async processOne(leaseOwner: string): Promise<string> {
    const leaseSeconds = 60;
    const claim = await this.broker.claim(leaseOwner, leaseSeconds);
    if (!claim) return "IDLE";
    try {
      if (
        Date.parse(claim.leaseExpiresAt) - Date.now() <
        this.config.integrationCredentialValidation.timeoutMs + 2_000
      ) {
        throw new KeywordResearchLeaseLostError();
      }
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
            claim.jobId,
            claim.credentialId,
            Boolean(claim.providerTaskId)
          )
        : selectIntegrationCredentialSecret(
            decryptedSecret,
            claim.jobId,
            claim.credentialId
          );
      if (claim.source === "KEYS_SO") {
        return await this.processKeysSo(claim, secret);
      }
      if (claim.source === "XMLSTOCK_WORDSTAT") {
        return await this.processXmlStockWordstat(claim, secret);
      }
      return await this.processWordstat(claim, secret, leaseSeconds);
    } catch (error) {
      if (error instanceof PaidOperationReviewError || error instanceof PaidOperationUnavailableError) {
        const review = error instanceof PaidOperationReviewError;
        const code = review ? "PAID_OPERATION_REQUIRES_REVIEW" : "PAID_OPERATION_UNAVAILABLE";
        if (claim.source === "ARSENKIN_WORDSTAT") await this.broker.transitionWordstat(claim, { action: "FAIL", code, ...(review ? {} : { retryAfterSeconds: 30 }) }).catch(() => {});
        else await this.broker.fail(claim, { code, retryable: !review, ...(review ? {} : { retryAfterSeconds: 30 }) }).catch(() => {});
        return review ? "ACTION_REQUIRED" : "RETRY_SCHEDULED";
      }
      if (error instanceof KeywordResearchLeaseLostError) return "LEASE_LOST";
      await (claim.source === "KEYS_SO" || claim.source === "XMLSTOCK_WORDSTAT"
        ? this.broker.fail(claim, {
            code: "CONNECTOR_INTERNAL_ERROR",
            retryable: true,
            retryAfterSeconds: 30
          })
        : claim.providerTaskId?.startsWith("submitting:")
          ? this.broker.transitionWordstat(claim, { action: "QUARANTINE" })
          : claim.providerTaskId
            ? this.broker.transitionWordstat(claim, {
                action: "DEFER",
                taskId: claim.providerTaskId,
                retryAfterSeconds: 30
              })
            : this.broker.transitionWordstat(claim, {
                action: "FAIL",
                code: "CONNECTOR_INTERNAL_ERROR",
                retryAfterSeconds: 30
              }))
        .catch(() => undefined);
      throw error;
    } finally {
      await this.refreshScheduler
        ?.scheduleAfterProviderOperation(claim.credentialId, claim.provider)
        .catch(() => undefined);
    }
  }

  private async runPaid<T extends object>(claim: PaidOperationClaimScope, part: string, network: () => Promise<T>, normalize?: (result: T) => T): Promise<T> {
    return this.billing ? this.billing.execute(claim, part, [], network, normalize) : network();
  }

  private async processXmlStockWordstat(
    claim: XmlStockResearchClaim,
    secret: Parameters<XmlStockWordstatConnector["expand"]>[1]
  ): Promise<string> {
    if (!claim) throw new KeywordResearchLeaseLostError();
    const query = claim.input.queries[claim.page - 1];
    if (!query) {
      await this.broker.fail(claim, {
        code: "CONNECTOR_INVALID_INPUT",
        retryable: false
      });
      return "FAILED";
    }
    const first = await this.broker.xmlStockSeedCheckpoint(claim, claim.page);
    if (first.state === "ACCEPTED") return this.applyXmlStockSeed(claim, first);
    if (first.state === "UNKNOWN") {
      return this.skipUnknownXmlStockSeed(claim);
    }
    if (first.state === "REJECTED" && !retryableXmlStockSeedFailure(first.errorCode)) {
      await this.broker.fail(claim, {
        code: first.errorCode ?? "PROVIDER_REQUEST_REJECTED",
        retryable: false
      });
      return "FAILED";
    }
    const remaining = claim.maxKeywords - claim.collectedKeywords;
    if (remaining < 1) throw new TypeError("XMLStock Wordstat research has no remaining scope");
    const parallelSeeds = first.state === "REJECTED"
      ? 1
      : Math.min(
          10,
          claim.input.queries.length - claim.page + 1,
          Math.max(1, Math.floor(remaining / 2_000))
        );
    const seedIndices = Array.from({ length: parallelSeeds }, (_, index) => claim.page + index);
    const preview = await Promise.all(seedIndices.map((index) =>
      index === claim.page ? Promise.resolve(first) : this.broker.xmlStockSeedCheckpoint(claim, index)
    ));
    const settled = await Promise.allSettled(seedIndices.map((index, offset) => {
      const cached = preview[offset]!;
      return cached.state === "ACCEPTED"
        ? Promise.resolve(cached)
        : cached.state === "UNKNOWN"
          ? Promise.resolve({ state: "UNKNOWN" as const })
        : cached.state === "REJECTED" && !retryableXmlStockSeedFailure(cached.errorCode)
          ? Promise.resolve({ state: "REJECTED" as const, errorCode: cached.errorCode ?? "PROVIDER_REQUEST_REJECTED" })
        : this.collectXmlStockSeed(claim, secret, index, remaining);
    }));
    const rejected = settled.find((item) => item.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    const results = settled.map((item) => {
      if (item.status !== "fulfilled") throw new TypeError("XMLStock seed was not settled");
      return item.value;
    });
    const current = results[0]!;
    if (current.state === "ACCEPTED") return this.applyXmlStockSeed(claim, current);
    if (current.state === "UNKNOWN") {
      return this.skipUnknownXmlStockSeed(claim);
    }
    const code = current.state === "REJECTED"
      ? current.errorCode ?? "PROVIDER_REQUEST_REJECTED"
      : "PROVIDER_RATE_LIMITED";
    const retryable = current.state === "CAPACITY" || retryableXmlStockSeedFailure(code);
    await this.broker.fail(claim, {
      code,
      retryable,
      ...(retryable ? { retryAfterSeconds: 5 } : {})
    });
    return retryable ? "RETRY_SCHEDULED" : "FAILED";
  }

  private async applyXmlStockSeed(
    claim: XmlStockResearchClaim,
    checkpoint: { readonly rows: readonly XmlStockWordstatExpansionRow[]; readonly responseHash: Buffer }
  ): Promise<string> {
    await this.broker.completeXmlStockSeed(claim, checkpoint);
    return claim.page >= claim.input.queries.length ||
      claim.collectedKeywords + checkpoint.rows.length >= claim.maxKeywords
      ? "READY_TO_IMPORT"
      : "XMLSTOCK_SEED_APPLIED";
  }

  private async skipUnknownXmlStockSeed(claim: XmlStockResearchClaim): Promise<string> {
    await this.broker.skipUnknownXmlStockSeed(claim);
    return claim.page >= claim.input.queries.length
      ? "READY_TO_IMPORT"
      : "XMLSTOCK_SEED_APPLIED";
  }

  private async collectXmlStockSeed(
    claim: XmlStockResearchClaim,
    secret: Parameters<XmlStockWordstatConnector["expand"]>[1],
    seedIndex: number,
    remaining: number
  ): Promise<XmlStockSeedCollectionOutcome> {
    const physicalKey = secret.rateLimitScopeId ?? claim.credentialId;
    const timeoutMs = this.config.integrationCredentialValidation.timeoutMs;
    let permit: Extract<XmlStockHttpQuotaPermit, { readonly allowed: true }> | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const acquired = await this.xmlStockQuota.tryAcquire({
        credentialId: physicalKey,
        workspaceId: claim.workspaceId,
        product: "WORDSTAT",
        leaseMs: timeoutMs + 5_000
      });
      if (acquired.allowed) { permit = acquired; break; }
      await new Promise((resolve) => setTimeout(resolve,
        Math.min(1_000, acquired.retryAfterMilliseconds)));
    }
    if (!permit) return { state: "CAPACITY" };
    try {
      const reservation = await this.broker.xmlStockSeedCheckpoint(claim, seedIndex, true);
      if (reservation.state === "ACCEPTED") return reservation;
      if (reservation.state !== "STARTED") return { state: "UNKNOWN" };
      const query = claim.input.queries[seedIndex - 1]!;
      let result: Awaited<ReturnType<XmlStockWordstatConnector["expand"]>>;
      try {
        result = await this.runPaid(claim, `SEED:${seedIndex}`, () => this.xmlStockWordstat.expand(
          {
            query,
            regionCode: claim.input.regionCode,
            device: claim.input.device,
            minusWords: claim.input.minusWords,
            clearMinusPhrases: claim.input.clearMinusPhrases,
            includeRightColumn: claim.input.includeRightColumn,
            clearPlus: claim.input.clearPlus,
            maxKeywords: Math.min(2_000, remaining)
          },
          secret,
          timeoutMs
        ), value => value.ok ? { ...value, raw: { rows: value.rows } } : value);
      } catch {
        await this.broker.finishXmlStockSeedCheckpoint(claim, seedIndex, {
          state: "UNKNOWN", errorCode: "XMLSTOCK_OUTCOME_UNKNOWN"
        });
        return { state: "UNKNOWN" };
      }
      if (!result.ok) {
        if (result.code === "PROVIDER_RATE_LIMITED") {
          await this.xmlStockQuota.penalize({
            credentialId: physicalKey, product: "WORDSTAT",
            ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds })
          });
        }
        const knownRejection = knownUnchargedXmlStockSeedFailure(result.code);
        await this.broker.finishXmlStockSeedCheckpoint(claim, seedIndex, {
          state: knownRejection ? "REJECTED" : "UNKNOWN",
          errorCode: knownRejection ? result.code : "XMLSTOCK_OUTCOME_UNKNOWN"
        });
        return knownRejection
          ? { state: "REJECTED", errorCode: result.code }
          : { state: "UNKNOWN" };
      }
      await this.xmlStockQuota.recordSuccess({ credentialId: physicalKey, product: "WORDSTAT" });
      const accepted = {
        state: "ACCEPTED" as const,
        rows: result.rows,
        responseHash: createHash("sha256").update(JSON.stringify(result.raw), "utf8").digest()
      };
      await this.broker.finishXmlStockSeedCheckpoint(claim, seedIndex, accepted);
      return accepted;
    } finally {
      await this.xmlStockQuota.release(permit);
    }
  }

  private async processKeysSo(
    claim: Extract<Awaited<ReturnType<KeywordResearchRuntimeBrokerService["claim"]>>, { readonly source: "KEYS_SO" }>,
    secret: Parameters<KeysSoKeywordResearchConnector["collect"]>[1]
  ): Promise<string> {
    if (!claim) throw new KeywordResearchLeaseLostError();
    const [result, inspection] = await Promise.all([
      this.keysSo.collect(
        {
          domain: claim.domain,
          database: claim.database,
          page: claim.page
        },
        secret,
        this.config.integrationCredentialValidation.timeoutMs
      ),
      claim.page === 1
        ? this.keysSo.inspectDomain(
            { domain: claim.domain, database: claim.database },
            secret,
            this.config.integrationCredentialValidation.timeoutMs
          )
        : Promise.resolve(undefined)
    ]);
      if (!result.ok) {
        await this.broker.fail(claim, result);
        return result.retryable ? "RETRY_SCHEDULED" : "FAILED";
      }
      if (inspection && !inspection.ok) {
        await this.broker.fail(claim, inspection);
        return inspection.retryable ? "RETRY_SCHEDULED" : "FAILED";
      }
      const remaining = claim.maxKeywords - claim.collectedKeywords;
      const rows = result.rows.slice(0, Math.max(0, remaining));
      const complete =
        rows.length === 0 ||
        rows.length < 25 ||
        claim.collectedKeywords + rows.length >= claim.maxKeywords ||
        (result.lastPage !== undefined && claim.page >= result.lastPage);
      await this.broker.completePage(claim, {
        rows,
        responseHash: createHash("sha256")
          .update(JSON.stringify({ keywords: result.raw, inspection: inspection?.raw }), "utf8")
          .digest(),
        ...(inspection?.totalAvailable === undefined && result.totalAvailable === undefined
          ? {}
          : { totalAvailable: inspection?.totalAvailable ?? result.totalAvailable }),
        ...(inspection ? { overview: inspection.overview, competitors: inspection.competitors } : {}),
        complete
      });
      return complete ? "READY_TO_IMPORT" : "PAGE_COMPLETED";
  }

  private async processWordstat(
    claim: Extract<Awaited<ReturnType<KeywordResearchRuntimeBrokerService["claim"]>>, { readonly source: "ARSENKIN_WORDSTAT" }>,
    secret: Parameters<ArsenkinWordstatExpansionConnector["submit"]>[1],
    leaseSeconds: number
  ): Promise<string> {
    if (!claim) throw new KeywordResearchLeaseLostError();
    if (claim.providerTaskId?.startsWith("submitting:")) {
      const acceptedTaskId = await this.billing?.acceptedTaskId(claim, []);
      if (acceptedTaskId) { await this.broker.transitionWordstat(claim, { action: "DEFER", taskId: acceptedTaskId, retryAfterSeconds: 5 }); return "RETRY_SCHEDULED"; }
      await this.broker.transitionWordstat(claim, { action: "QUARANTINE" });
      return "ACTION_REQUIRED";
    }
    if (!claim.providerTaskId) {
      const marker = `submitting:${randomUUID()}`;
      const result = await this.runPaid(claim, "TASK", () => this.wordstat.submit(
        claim.input,
        secret,
        this.config.integrationCredentialValidation.timeoutMs,
        () => this.broker.markSubmitting(claim, marker, leaseSeconds)
      ));
      if (result.status === "ACCEPTED") {
        await this.broker.transitionWordstat(claim, {
          action: "DEFER",
          taskId: result.taskId,
          retryAfterSeconds: 5
        });
        return "RETRY_SCHEDULED";
      }
      if (result.status === "OUTCOME_UNKNOWN") {
        await this.broker.transitionWordstat(claim, { action: "QUARANTINE" });
        return "ACTION_REQUIRED";
      }
      if (result.status === "RETRYABLE_FAILURE" && result.code === "PROVIDER_CONCURRENCY_LIMITED") {
        await this.broker.transitionWordstat(claim, {
          action: "CAPACITY",
          retryAfterSeconds: result.retryAfterSeconds ?? 5
        });
        return "RETRY_SCHEDULED";
      }
      await this.broker.transitionWordstat(claim, {
        action: "FAIL",
        code: result.code,
        ...(result.status === "RETRYABLE_FAILURE"
          ? { retryAfterSeconds: result.retryAfterSeconds ?? 30 }
          : {})
      });
      return result.status === "RETRYABLE_FAILURE" ? "RETRY_SCHEDULED" : "FAILED";
    }
    const result = await this.wordstat.fetchResult(
      claim.providerTaskId,
      claim.input,
      secret,
      this.config.integrationCredentialValidation.timeoutMs
    );
    if (result.status === "READY") {
      await this.broker.transitionWordstat(claim, {
        action: "COMPLETE",
        rows: result.rows,
        responseHash: createHash("sha256")
          .update(JSON.stringify(result.raw), "utf8")
          .digest()
      });
      return "READY_TO_IMPORT";
    }
    if (result.status === "PENDING" || result.status === "RETRYABLE_FAILURE") {
      await this.broker.transitionWordstat(claim, {
        action: "DEFER",
        taskId: claim.providerTaskId,
        retryAfterSeconds: result.retryAfterSeconds ?? 5
      });
      return "RETRY_SCHEDULED";
    }
    await this.broker.transitionWordstat(claim, {
      action: "FAIL",
      code: result.code
    });
    return "FAILED";
  }
}
