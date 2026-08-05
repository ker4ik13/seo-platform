import { Injectable } from "@nestjs/common";
import type { IntegrationProvider } from "@seo-platform/contracts";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import { IntegrationCredentialExecutionBrokerService } from "./integration-credential-execution-broker.service.js";

const PROVIDERS: readonly IntegrationProvider[] = [
  "XMLSTOCK",
  "ARSENKIN",
  "KEYS_SO"
];
const REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

@Injectable()
export class IntegrationCredentialRefreshSchedulerService {
  public constructor(
    private readonly broker: IntegrationCredentialExecutionBrokerService,
    private readonly connectors: IntegrationCredentialConnectorRegistry
  ) {}

  public scheduleHourlyRefreshes(): Promise<readonly string[]> {
    return this.broker.scheduleValidationRefreshes({
      staleBefore: new Date(Date.now() - REFRESH_INTERVAL_MS),
      connectorVersions: this.connectorVersions(),
      reason: "HOURLY",
      limit: 100
    });
  }

  public async scheduleAfterProviderOperation(
    credentialId: string
  ): Promise<void> {
    await this.broker.scheduleValidationRefreshes({
      credentialIds: [credentialId],
      connectorVersions: this.connectorVersions(),
      reason: "PROVIDER_OPERATION",
      limit: 1
    });
  }

  private connectorVersions(): Readonly<Record<IntegrationProvider, string>> {
    return Object.fromEntries(
      PROVIDERS.map((provider) => [provider, this.connectors.version(provider)])
    ) as Readonly<Record<IntegrationProvider, string>>;
  }
}
