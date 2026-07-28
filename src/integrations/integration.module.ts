import { Module } from "@nestjs/common";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import { IntegrationCredentialController } from "./integration-credential.controller.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integration-credential-key-coverage.service.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";

@Module({
  controllers: [IntegrationCredentialController],
  providers: [
    IntegrationCredentialApiGuard,
    IntegrationCredentialCryptoService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialService
  ]
})
export class IntegrationModule {}
