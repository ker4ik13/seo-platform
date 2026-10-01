import { Module } from "@nestjs/common";
import { RemoteWorkClientModule } from "./worker-nodes/remote-work-client.module.js";
import { RemoteProviderTransportService } from "./worker-nodes/remote-provider-transport.service.js";
import type { AppConfig } from "./config/app-config.js";
import { PaidOperationRuntimeService } from "./paid-operations/paid-operation-runtime.service.js";
import { APP_CONFIG, ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { IntegrationCredentialConnectorRegistry } from "./integrations/integration-credential-connector.registry.js";
import { IntegrationCredentialCryptoService } from "./integrations/integration-credential-crypto.service.js";
import { IntegrationCredentialExecutionBrokerService } from "./integrations/integration-credential-execution-broker.service.js";
import { IntegrationCredentialKeyCoverageService } from "./integrations/integration-credential-key-coverage.service.js";
import { IntegrationCredentialValidationWorkerService } from "./integrations/integration-credential-validation-worker.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "./integrations/integration-credential-refresh-scheduler.service.js";
import { PlatformCredentialPoolSelectionService } from "./integrations/platform-credential-pool-selection.service.js";
import { ArsenkinHttpRateLimiter } from "./integrations/arsenkin-http-rate-limiter.js";
import { XmlStockHttpQuotaLimiter } from "./integrations/xmlstock-http-quota-limiter.js";
import { ArsenkinRankConnector } from "./rank-runs/arsenkin-rank.connector.js";
import { XmlStockRankConnector } from "./rank-runs/xmlstock-rank.connector.js";
import { RankConnectorRuntimeBrokerService } from "./rank-runs/rank-connector-runtime-broker.service.js";
import { KeysSoKeywordResearchConnector } from "./keyword-research/keys-so-keyword-research.connector.js";
import { ArsenkinWordstatExpansionConnector } from "./keyword-research/arsenkin-wordstat-expansion.connector.js";
import { KeywordResearchRuntimeBrokerService } from "./keyword-research/keyword-research-runtime-broker.service.js";
import { KeywordResearchRuntimeService } from "./keyword-research/keyword-research-runtime.service.js";
import {
  ARSENKIN_WORDSTAT_EXPANSION_CONNECTOR,
  KEYS_SO_KEYWORD_RESEARCH_CONNECTOR
} from "./keyword-research/keyword-research.tokens.js";
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
import { AiAnswerRuntimeBrokerService } from "./ai-answer-collections/ai-answer-runtime-broker.service.js";
import { AiAnswerRuntimeService } from "./ai-answer-collections/ai-answer-runtime.service.js";
import { ArsenkinAiAnswerConnector } from "./ai-answer-collections/arsenkin-ai-answer.connector.js";
import { ArsenkinClusteringConnector } from "./clustering-runs/arsenkin-clustering.connector.js";
import { ClusteringRuntimeBrokerService } from "./clustering-runs/clustering-runtime-broker.service.js";
import { ClusteringRuntimeService } from "./clustering-runs/clustering-runtime.service.js";
import { PlatformApiModule } from "./platform-api/platform-api.module.js";

@Module({
  imports: [
    ConfigModule.forRole("CONNECTOR_WORKER"),
    DatabaseModule,
    SeoDataModule,
    PlatformApiModule
    ,RemoteWorkClientModule
  ],
  providers: [
    RemoteProviderTransportService,
    PaidOperationRuntimeService,
    ArsenkinHttpRateLimiter,
    XmlStockHttpQuotaLimiter,
    IntegrationCredentialConnectorRegistry,
    IntegrationCredentialCryptoService,
    IntegrationCredentialExecutionBrokerService,
    IntegrationCredentialKeyCoverageService,
    IntegrationCredentialValidationWorkerService,
    IntegrationCredentialRefreshSchedulerService,
    PlatformCredentialPoolSelectionService,
    RankConnectorRuntimeBrokerService,
    RankConnectorRuntimeService,
    KeywordResearchRuntimeBrokerService,
    KeywordResearchRuntimeService,
    FrequencyCollectionRuntimeBrokerService,
    FrequencyCollectionRuntimeService,
    AiAnswerRuntimeBrokerService,
    AiAnswerRuntimeService,
    ClusteringRuntimeBrokerService,
    ClusteringRuntimeService,
    {
      provide: XmlStockWordstatConnector,
      inject: [APP_CONFIG,RemoteProviderTransportService],
      useFactory: (config: AppConfig,remote:RemoteProviderTransportService) =>
        new XmlStockWordstatConnector(remote.fetcher, config.xmlStockSoftId)
    },
    {
      provide: ArsenkinWordstatConnector,
      inject: [ArsenkinHttpRateLimiter,RemoteProviderTransportService],
      useFactory: (rateLimiter: ArsenkinHttpRateLimiter,remote:RemoteProviderTransportService) =>
        new ArsenkinWordstatConnector(rateLimiter,remote.fetcher)
    },
    {
      provide: ArsenkinAiAnswerConnector,
      inject: [ArsenkinHttpRateLimiter,RemoteProviderTransportService],
      useFactory: (rateLimiter: ArsenkinHttpRateLimiter,remote:RemoteProviderTransportService) =>
        new ArsenkinAiAnswerConnector(rateLimiter,remote.fetcher)
    },
    {
      provide: ArsenkinClusteringConnector,
      inject: [ArsenkinHttpRateLimiter,RemoteProviderTransportService],
      useFactory: (rateLimiter: ArsenkinHttpRateLimiter,remote:RemoteProviderTransportService) =>
        new ArsenkinClusteringConnector(rateLimiter,remote.fetcher)
    },
    {
      provide: KEYS_SO_KEYWORD_RESEARCH_CONNECTOR,
      inject:[RemoteProviderTransportService],
      useFactory: (remote:RemoteProviderTransportService) => new KeysSoKeywordResearchConnector(remote.fetcher)
    },
    {
      provide: ARSENKIN_WORDSTAT_EXPANSION_CONNECTOR,
      inject: [ArsenkinHttpRateLimiter,RemoteProviderTransportService],
      useFactory: (rateLimiter: ArsenkinHttpRateLimiter,remote:RemoteProviderTransportService) =>
        new ArsenkinWordstatExpansionConnector(rateLimiter,remote.fetcher)
    },
    {
      provide: ARSENKIN_RANK_CONNECTOR,
      inject: [ArsenkinHttpRateLimiter,RemoteProviderTransportService],
      useFactory: (rateLimiter: ArsenkinHttpRateLimiter,remote:RemoteProviderTransportService) =>
        new ArsenkinRankConnector(rateLimiter,remote.fetcher)
    },
    {
      provide: XMLSTOCK_RANK_CONNECTOR,
      inject: [APP_CONFIG,RemoteProviderTransportService],
      useFactory: (config: AppConfig,remote:RemoteProviderTransportService) =>
        new XmlStockRankConnector(remote.fetcher, config.xmlStockSoftId)
    }
  ]
})
export class ConnectorWorkerModule {}
