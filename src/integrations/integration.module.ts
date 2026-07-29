import { Module } from "@nestjs/common";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import { IntegrationCredentialController } from "./integration-credential.controller.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integration-credential-key-coverage.service.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import { IntegrationCredentialValidationService } from "./integration-credential-validation.service.js";

@Module({
  controllers: [IntegrationCredentialController],
  providers: [
    IntegrationCredentialApiGuard,
    IntegrationCredentialConnectorRegistry,
    IntegrationCredentialCryptoService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialService,
    IntegrationCredentialValidationService
  ]
})
export class IntegrationModule {}
