import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { IntegrationCredentialConnectorRegistry } from "./integrations/integration-credential-connector.registry.js";
import { IntegrationCredentialCryptoService } from "./integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialExecutionBrokerService } from "./integrations/integration-credential-execution-broker.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integrations/integration-credential-key-coverage.service.js";
import { IntegrationCredentialValidationWorkerService } from "./integrations/integration-credential-validation-worker.service.js";
import { ArsenkinRankConnector } from "./rank-runs/arsenkin-rank.connector.js";
import { RankConnectorRuntimeBrokerService } from "./rank-runs/rank-connector-runtime-broker.service.js";
import { KeysSoKeywordResearchConnector } from "./keyword-research/keys-so-keyword-research.connector.js";
import { KeywordResearchRuntimeBrokerService } from "./keyword-research/keyword-research-runtime-broker.service.js";
import { KeywordResearchRuntimeService } from "./keyword-research/keyword-research-runtime.service.js";
import { KEYS_SO_KEYWORD_RESEARCH_CONNECTOR } from "./keyword-research/keyword-research.tokens.js";
import {
  ARSENKIN_RANK_CONNECTOR,
  RankConnectorRuntimeService
} from "./rank-runs/rank-connector-runtime.service.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";
import { FrequencyCollectionRuntimeBrokerService } from "./frequency-collections/frequency-collection-runtime-broker.service.js";
import { FrequencyCollectionRuntimeService } from "./frequency-collections/frequency-collection-runtime.service.js";
import { XmlStockWordstatConnector } from "./frequency-collections/xmlstock-wordstat.connector.js";

@Module({
  imports: [ConfigModule.forRole("CONNECTOR_WORKER"), DatabaseModule, SeoDataModule],
  providers: [
    IntegrationCredentialConnectorRegistry,
    IntegrationCredentialCryptoService,
    IntegrationCredentialExecutionBrokerService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialValidationWorkerService,
    RankConnectorRuntimeBrokerService,
    RankConnectorRuntimeService,
    KeywordResearchRuntimeBrokerService,
    KeywordResearchRuntimeService,
    FrequencyCollectionRuntimeBrokerService,
    FrequencyCollectionRuntimeService,
    {
      provide: XmlStockWordstatConnector,
      useFactory: () => new XmlStockWordstatConnector()
    },
    {
      provide: KEYS_SO_KEYWORD_RESEARCH_CONNECTOR,
      useFactory: () => new KeysSoKeywordResearchConnector()
    },
    {
      provide: ARSENKIN_RANK_CONNECTOR,
      useFactory: () => new ArsenkinRankConnector()
    }
  ]
})
export class ConnectorWorkerModule {}
