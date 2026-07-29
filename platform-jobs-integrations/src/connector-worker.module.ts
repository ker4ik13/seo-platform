import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { IntegrationCredentialConnectorRegistry } from "./integrations/integration-credential-connector.registry.js";
import { IntegrationCredentialCryptoService } from "./integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integrations/integration-credential-key-coverage.service.js";
import { IntegrationCredentialValidationWorkerService } from "./integrations/integration-credential-validation-worker.service.js";

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    IntegrationCredentialConnectorRegistry,
    IntegrationCredentialCryptoService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialValidationWorkerService
  ]
})
export class ConnectorWorkerModule {}
