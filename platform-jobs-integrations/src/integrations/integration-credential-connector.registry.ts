import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { IntegrationProvider } from "@seo-platform/contracts";
import { ArsenkinCredentialValidationConnector } from "./arsenkin-credential-validation.connector.js";
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

  public constructor() {
    const connectors: readonly IntegrationCredentialValidationConnector[] = [
      new XmlStockCredentialValidationConnector(),
      new ArsenkinCredentialValidationConnector(),
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

function validationUnavailable(): UnprocessableEntityException {
  return new UnprocessableEntityException(
    "Provider credential validation requires authenticated provider documentation"
  );
}
