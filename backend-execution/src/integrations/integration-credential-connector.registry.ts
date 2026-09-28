import {
  Inject,
  Injectable,
  Optional,
  UnprocessableEntityException
} from "@nestjs/common";
import type { IntegrationProvider } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { ArsenkinCredentialValidationConnector } from "./arsenkin-credential-validation.connector.js";
import {
  ArsenkinHttpRateLimiter,
  type ArsenkinHttpRateLimitGate
} from "./arsenkin-http-rate-limiter.js";
import type {
  CredentialValidationResult,
  IntegrationCredentialValidationConnector
} from "./integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";
import { integrationProviderMetadata } from "./integration-provider-catalog.js";
import { KeysSoCredentialValidationConnector } from "./keys-so-credential-validation.connector.js";
import { XmlStockCredentialValidationConnector } from "./xmlstock-credential-validation.connector.js";

@Injectable()
export class IntegrationCredentialConnectorRegistry {
  private readonly connectors: ReadonlyMap<
    IntegrationProvider,
    IntegrationCredentialValidationConnector
  >;

  public constructor(
    @Optional() rateLimiter?: ArsenkinHttpRateLimiter,
    @Optional() @Inject(APP_CONFIG) config?: AppConfig
  ) {
    const connectors: readonly IntegrationCredentialValidationConnector[] = [
      new XmlStockCredentialValidationConnector(fetch, config?.xmlStockSoftId),
      new ArsenkinCredentialValidationConnector(
        rateLimiter ?? ARSENKIN_VALIDATION_DISABLED_GATE
      ),
      new KeysSoCredentialValidationConnector()
    ];
    this.connectors = new Map(
      connectors.map((connector) => [connector.provider, connector])
    );
  }

  public version(provider: IntegrationProvider): string {
    return this.required(provider).version;
  }

  public async validate(
    provider: IntegrationProvider,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<CredentialValidationResult> {
    return this.required(provider).validate(secret, timeoutMs);
  }

  private required(
    provider: IntegrationProvider
  ): IntegrationCredentialValidationConnector {
    if (
      integrationProviderMetadata(provider).credentialValidationMode !==
      "ACCOUNT_METADATA"
    ) {
      throw validationUnavailable();
    }
    const connector = this.connectors.get(provider);
    if (!connector) throw validationUnavailable();
    return connector;
  }
}

// The HTTP management process uses this registry only for connector versions.
// If validation is accidentally invoked outside connector-worker, fail closed
// before any provider request instead of bypassing the shared rate limiter.
const ARSENKIN_VALIDATION_DISABLED_GATE: ArsenkinHttpRateLimitGate = {
  async tryAcquire() {
    return { allowed: false, retryAfterSeconds: 3_600 };
  }
};

function validationUnavailable(): UnprocessableEntityException {
  return new UnprocessableEntityException(
    "Provider credential validation requires authenticated provider documentation"
  );
}
