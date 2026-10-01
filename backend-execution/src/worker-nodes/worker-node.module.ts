import { Module } from "@nestjs/common";
import { IntegrationModule } from "../integrations/integration.module.js";
import { PlatformApiModule } from "../platform-api/platform-api.module.js";
import { XmlStockHttpQuotaLimiter } from "../integrations/xmlstock-http-quota-limiter.js";
import { PlatformCredentialPoolSelectionService } from "../integrations/platform-credential-pool-selection.service.js";
import { RankConnectorRuntimeBrokerService } from "../rank-runs/rank-connector-runtime-broker.service.js";
import { WorkerGatewayController, WorkerNodeAdminController } from "./worker-node.controller.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";
import { RemoteWorkGatewayService } from "./remote-work-gateway.service.js";
import { RemoteWorkController,RemoteWorkReceiptController } from "./remote-work.controller.js";
import { StorageModule } from "../storage/storage.module.js";

@Module({
  imports: [IntegrationModule, PlatformApiModule,StorageModule],
  controllers: [WorkerGatewayController, WorkerNodeAdminController,RemoteWorkController,RemoteWorkReceiptController],
  providers: [
    WorkerNodeService,
    WorkerRankGatewayService,
    RemoteWorkGatewayService,
    RankConnectorRuntimeBrokerService,
    PlatformCredentialPoolSelectionService,
    XmlStockHttpQuotaLimiter
  ],
  exports: [WorkerNodeService]
})
export class WorkerNodeModule {}
