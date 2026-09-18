import { createHash, randomUUID } from "node:crypto";
import { selectIntegrationCredentialSecret } from "../integrations/platform-credential-pool.js";
import { PaidOperationRuntimeService, PaidOperationReviewError, PaidOperationUnavailableError, type PaidOperationClaimScope } from "../paid-operations/paid-operation-runtime.service.js";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "../integrations/integration-credential-refresh-scheduler.service.js";
import { XmlStockHttpQuotaLimiter } from "../integrations/xmlstock-http-quota-limiter.js";
import { XmlStockWordstatConnector } from "../frequency-collections/xmlstock-wordstat.connector.js";
import {
  ARSENKIN_WORDSTAT_EXPANSION_CONNECTOR,
  KEYS_SO_KEYWORD_RESEARCH_CONNECTOR,
  type ArsenkinWordstatExpansionConnector,
  type KeysSoKeywordResearchConnector
} from "./keyword-research.tokens.js";
import {
  KeywordResearchLeaseLostError,
  KeywordResearchRuntimeBrokerService
} from "./keyword-research-runtime-broker.service.js";

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
    @Optional() private readonly billing?: PaidOperationRuntimeService
  ) {}

  public async processOne(leaseOwner: string): Promise<string> {
    const leaseSeconds = Math.min(
      60,
      Math.max(
        10,
        Math.ceil(
          (this.config.integrationCredentialValidation.timeoutMs + 5_000) /
            1_000
        )
      )
    );
    const claim = await this.broker.claim(leaseOwner, leaseSeconds);
    if (!claim) return "IDLE";
    try {
      if (
        Date.parse(claim.leaseExpiresAt) - Date.now() <
        this.config.integrationCredentialValidation.timeoutMs + 2_000
      ) {
        throw new KeywordResearchLeaseLostError();
      }
      const secret = selectIntegrationCredentialSecret(this.crypto.decrypt(
        claim.workspaceId,
        claim.provider,
        claim.credentialId,
        claim.encryptedCredential
      ), claim.jobId, claim.credentialId);
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
    claim: Extract<Awaited<ReturnType<KeywordResearchRuntimeBrokerService["claim"]>>, { readonly source: "XMLSTOCK_WORDSTAT" }>,
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
    const remaining = claim.maxKeywords - claim.collectedKeywords;
    const timeoutMs = this.config.integrationCredentialValidation.timeoutMs;
    const acquired = await this.xmlStockQuota.tryAcquire({
      credentialId: secret.rateLimitScopeId ?? claim.credentialId,
      product: "WORDSTAT",
      leaseMs: timeoutMs + 5_000
    });
    if (!acquired.allowed) {
      await this.broker.fail(claim, {
        code: "PROVIDER_RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: Math.max(5, acquired.retryAfterSeconds)
      });
      return "RETRY_SCHEDULED";
    }
    try {
      const result = await this.runPaid(claim, `SEED:${claim.page}`, () => this.xmlStockWordstat.expand(
        {
          query,
          regionCode: claim.input.regionCode,
          device: claim.input.device,
          minusWords: claim.input.minusWords,
          clearMinusPhrases: claim.input.clearMinusPhrases,
          includeRightColumn: claim.input.includeRightColumn,
          clearPlus: claim.input.clearPlus,
          maxKeywords: Math.min(2_000, Math.max(1, remaining))
        },
        secret,
        timeoutMs
      ), result => result.ok ? { ...result, raw: { rows: result.rows } } : result);
      if (!result.ok) {
        if (result.code === "PROVIDER_RATE_LIMITED") {
          await this.xmlStockQuota.penalize({
            credentialId: secret.rateLimitScopeId ?? claim.credentialId,
            product: "WORDSTAT",
            ...(result.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: result.retryAfterSeconds })
          });
        }
        await this.broker.fail(claim, result);
        return result.retryable ? "RETRY_SCHEDULED" : "FAILED";
      }
      await this.xmlStockQuota.recordSuccess({
        credentialId: secret.rateLimitScopeId ?? claim.credentialId,
        product: "WORDSTAT"
      });
      await this.broker.completeXmlStockSeed(claim, {
        rows: result.rows,
        responseHash: createHash("sha256")
          .update(JSON.stringify(result.raw), "utf8")
          .digest()
      });
      return claim.page >= claim.input.queries.length ||
        claim.collectedKeywords + result.rows.length >= claim.maxKeywords
        ? "READY_TO_IMPORT"
        : "PAGE_COMPLETED";
    } finally {
      await this.xmlStockQuota.release(acquired);
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
