import { Module } from "@nestjs/common";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import { IntegrationCredentialController } from "./integration-credential.controller.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integration-credential-key-coverage.service.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import { IntegrationCredentialValidationService } from "./integration-credential-validation.service.js";
import { ProjectConnectorBindingController } from "./project-connector-binding.controller.js";
import { ProjectConnectorBindingService } from "./project-connector-binding.service.js";

@Module({
  controllers: [
    IntegrationCredentialController,
    ProjectConnectorBindingController
  ],
  providers: [
    IntegrationCredentialApiGuard,
    IntegrationCredentialConnectorRegistry,
    IntegrationCredentialCryptoService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialService,
    IntegrationCredentialValidationService,
    ProjectConnectorBindingService
  ],
  exports: [IntegrationCredentialApiGuard]
})
export class IntegrationModule {}
