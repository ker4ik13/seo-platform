import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { IntegrationCredentialConnectorRegistry } from "./integrations/integration-credential-connector.registry.js";
import { IntegrationCredentialCryptoService } from "./integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialExecutionBrokerService } from "./integrations/integration-credential-execution-broker.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integrations/integration-credential-key-coverage.service.js";
import { IntegrationCredentialValidationWorkerService } from "./integrations/integration-credential-validation-worker.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "./integrations/integration-credential-refresh-scheduler.service.js";
import { ArsenkinHttpRateLimiter } from "./integrations/arsenkin-http-rate-limiter.js";
import { XmlStockHttpQuotaLimiter } from "./integrations/xmlstock-http-quota-limiter.js";
import { ArsenkinRankConnector } from "./rank-runs/arsenkin-rank.connector.js";
import { XmlStockRankConnector } from "./rank-runs/xmlstock-rank.connector.js";
import { RankConnectorRuntimeBrokerService } from "./rank-runs/rank-connector-runtime-broker.service.js";
import { KeysSoKeywordResearchConnector } from "./keyword-research/keys-so-keyword-research.connector.js";
import { KeywordResearchRuntimeBrokerService } from "./keyword-research/keyword-research-runtime-broker.service.js";
import { KeywordResearchRuntimeService } from "./keyword-research/keyword-research-runtime.service.js";
import { KEYS_SO_KEYWORD_RESEARCH_CONNECTOR } from "./keyword-research/keyword-research.tokens.js";
import {
  ARSENKIN_RANK_CONNECTOR,
  RankConnectorRuntimeService,
  XMLSTOCK_RANK_CONNECTOR
} from "./rank-runs/rank-connector-runtime.service.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";
import { FrequencyCollectionRuntimeBrokerService } from "./frequency-collections/frequency-collection-runtime-broker.service.js";
import { FrequencyCollectionRuntimeService } from "./frequency-collections/frequency-collection-runtime.service.js";
import { XmlStockWordstatConnector } from "./frequency-collections/xmlstock-wordstat.connector.js";
import { ArsenkinWordstatConnector } from "./frequency-collections/arsenkin-wordstat.connector.js";

@Module({
  imports: [ConfigModule.forRole("CONNECTOR_WORKER"), DatabaseModule, SeoDataModule],
  providers: [
    ArsenkinHttpRateLimiter,
    XmlStockHttpQuotaLimiter,
    IntegrationCredentialConnectorRegistry,
    IntegrationCredentialCryptoService,
    IntegrationCredentialExecutionBrokerService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialValidationWorkerService,
    IntegrationCredentialRefreshSchedulerService,
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
      provide: ArsenkinWordstatConnector,
      inject: [ArsenkinHttpRateLimiter],
      useFactory: (rateLimiter: ArsenkinHttpRateLimiter) =>
        new ArsenkinWordstatConnector(rateLimiter)
    },
    {
      provide: KEYS_SO_KEYWORD_RESEARCH_CONNECTOR,
      useFactory: () => new KeysSoKeywordResearchConnector()
    },
    {
      provide: ARSENKIN_RANK_CONNECTOR,
      inject: [ArsenkinHttpRateLimiter],
      useFactory: (rateLimiter: ArsenkinHttpRateLimiter) =>
        new ArsenkinRankConnector(rateLimiter)
    },
    {
      provide: XMLSTOCK_RANK_CONNECTOR,
      useFactory: () => new XmlStockRankConnector()
    }
  ]
})
export class ConnectorWorkerModule {}
