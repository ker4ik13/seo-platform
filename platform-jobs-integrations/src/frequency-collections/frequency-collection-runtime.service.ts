import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { SeoDataClient, SeoDataClientError } from "../seo-data/seo-data.client.js";
import {
  FrequencyCollectionLeaseLostError,
  FrequencyCollectionRuntimeBrokerService
} from "./frequency-collection-runtime-broker.service.js";
import {
  WordstatQueryError,
  XmlStockWordstatConnector
} from "./xmlstock-wordstat.connector.js";

@Injectable()
export class FrequencyCollectionRuntimeService {
  public constructor(
    private readonly broker: FrequencyCollectionRuntimeBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    private readonly seoData: SeoDataClient,
    private readonly connector: XmlStockWordstatConnector,
    @Inject(APP_CONFIG) private readonly config: AppConfig
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
    const timeoutMs = this.config.integrationCredentialValidation.timeoutMs;
    const leaseSeconds = Math.min(60, Math.max(10, Math.ceil((timeoutMs * 3 + 5_000) / 1_000)));
    const claim = await this.broker.claim(leaseOwner, leaseSeconds);
    if (!claim) return "IDLE";
    try {
      if (Date.parse(claim.leaseExpiresAt) - Date.now() < timeoutMs + 2_000) {
        throw new FrequencyCollectionLeaseLostError();
      }
      const keyword = await this.seoData.resolveFrequencyKeyword({
        workspaceId: claim.workspaceId,
        projectId: claim.projectId,
        actorId: claim.actorId,
        keywordId: claim.keywordId,
        version: claim.keywordVersion
      });
      const secret = this.crypto.decrypt(
        claim.workspaceId,
        "XMLSTOCK",
        claim.credentialId,
        claim.encryptedCredential
      );
      const snapshots: Array<{
        readonly type: (typeof claim.types)[number];
        readonly regionCode: string;
        readonly device: typeof claim.device;
        readonly period: "LAST_30_DAYS";
        readonly value: string;
        readonly provider: "XMLSTOCK";
        readonly sourceMode: "BYOK";
        readonly qualityFlags: readonly [];
      }> = [];
      for (const type of claim.types) {
        const result = await this.connector.collect(
          {
            keyword: keyword.text,
            type,
            regionCode: claim.regionCode,
            device: claim.device
          },
          secret,
          timeoutMs
        );
        if (!result.ok) {
          await this.broker.fail(claim, result);
          return result.retryable ? "RETRY_SCHEDULED" : "FAILED_ITEM";
        }
        snapshots.push({
          type,
          regionCode: claim.regionCode,
          device: claim.device,
          period: "LAST_30_DAYS",
          value: result.value,
          provider: "XMLSTOCK",
          sourceMode: "BYOK",
          qualityFlags: []
        });
      }
      const observedAt = new Date().toISOString();
      await this.seoData.persistFrequencySnapshots({
        workspaceId: claim.workspaceId,
        projectId: claim.projectId,
        actorId: claim.actorId,
        jobId: claim.jobId,
        keywordId: claim.keywordId,
        keywordVersion: claim.keywordVersion,
        observedAt,
        snapshots
      });
      await this.broker.complete(claim, snapshots.length);
      return "COMPLETED_ITEM";
    } catch (error) {
      if (error instanceof FrequencyCollectionLeaseLostError) return "LEASE_LOST";
      if (error instanceof WordstatQueryError) {
        await this.broker.fail(claim, {
          code: "INVALID_WORDSTAT_QUERY",
          retryable: false
        });
        return "FAILED_ITEM";
      }
      if (error instanceof SeoDataClientError && !error.retryable) {
        await this.broker.fail(claim, {
          code: error.code === "CONFLICT" ? "KEYWORD_VERSION_CONFLICT" : "KEYWORD_NOT_AVAILABLE",
          retryable: false
        });
        return "FAILED_ITEM";
      }
      await this.broker
        .fail(claim, {
          code: "CONNECTOR_INTERNAL_ERROR",
          retryable: true,
          retryAfterSeconds: 30
        })
        .catch(() => undefined);
      throw error;
    }
  }
}
