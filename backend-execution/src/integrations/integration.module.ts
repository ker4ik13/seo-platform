import { Module } from "@nestjs/common";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import { IntegrationCredentialController } from "./integration-credential.controller.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { IntegrationCredentialExecutionBrokerService } from "./integration-credential-execution-broker.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integration-credential-key-coverage.service.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import { IntegrationCredentialValidationService } from "./integration-credential-validation.service.js";
import { ProjectConnectorBindingController } from "./project-connector-binding.controller.js";
import { ProjectConnectorBindingService } from "./project-connector-binding.service.js";
import { ProjectTransferResetController } from "./project-transfer-reset.controller.js";
import { ProjectTransferResetService } from "./project-transfer-reset.service.js";
import { WorkspaceConnectorRoutingController } from "./workspace-connector-routing.controller.js";
import { WorkspaceConnectorRoutingService } from "./workspace-connector-routing.service.js";

@Module({
  controllers: [
    IntegrationCredentialController,
    ProjectConnectorBindingController,
    ProjectTransferResetController,
    WorkspaceConnectorRoutingController
  ],
  providers: [
    IntegrationCredentialApiGuard,
    IntegrationCredentialConnectorRegistry,
    IntegrationCredentialCryptoService,
    IntegrationCredentialExecutionBrokerService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialService,
    IntegrationCredentialValidationService,
    ProjectConnectorBindingService,
    ProjectTransferResetService,
    WorkspaceConnectorRoutingService
  ],
  exports: [IntegrationCredentialApiGuard, WorkspaceConnectorRoutingService]
})
export class IntegrationModule {}
