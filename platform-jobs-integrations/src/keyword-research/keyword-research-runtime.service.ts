import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import {
  KEYS_SO_KEYWORD_RESEARCH_CONNECTOR,
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
    private readonly connector: KeysSoKeywordResearchConnector,
    @Inject(APP_CONFIG) private readonly config: AppConfig
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
      const secret = this.crypto.decrypt(
        claim.workspaceId,
        "KEYS_SO",
        claim.credentialId,
        claim.encryptedCredential
      );
      const result = await this.connector.collect(
        {
          domain: claim.domain,
          database: claim.database,
          page: claim.page
        },
        secret,
        this.config.integrationCredentialValidation.timeoutMs
      );
      if (!result.ok) {
        await this.broker.fail(claim, result);
        return result.retryable ? "RETRY_SCHEDULED" : "FAILED";
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
          .update(JSON.stringify(result.raw), "utf8")
          .digest(),
        ...(result.totalAvailable === undefined
          ? {}
          : { totalAvailable: result.totalAvailable }),
        complete
      });
      return complete ? "READY_TO_IMPORT" : "PAGE_COMPLETED";
    } catch (error) {
      if (error instanceof KeywordResearchLeaseLostError) return "LEASE_LOST";
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
