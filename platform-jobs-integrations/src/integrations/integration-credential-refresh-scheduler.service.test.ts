import assert from "node:assert/strict";
import test from "node:test";
import type { IntegrationProvider } from "@seo-platform/contracts";
import { IntegrationCredentialRefreshSchedulerService } from "./integration-credential-refresh-scheduler.service.js";
import type { IntegrationCredentialExecutionBrokerService } from "./integration-credential-execution-broker.service.js";
import type { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";

test("schedules stale credentials hourly with every supported connector version", async () => {
  const calls: unknown[] = [];
  const broker = {
    scheduleValidationRefreshes: async (input: unknown) => {
      calls.push(input);
      return ["019fc000-0000-7000-8000-000000000001"];
    }
  } as unknown as IntegrationCredentialExecutionBrokerService;
  const connectors = {
    version: (provider: IntegrationProvider) => `${provider.toLowerCase()}@test`
  } as unknown as IntegrationCredentialConnectorRegistry;

  const before = Date.now() - 60 * 60 * 1_000;
  const result = await new IntegrationCredentialRefreshSchedulerService(
    broker,
    connectors
  ).scheduleHourlyRefreshes();

  assert.deepEqual(result, ["019fc000-0000-7000-8000-000000000001"]);
  const call = calls[0] as {
    staleBefore: Date;
    reason: string;
    limit: number;
    connectorVersions: Readonly<Record<string, string>>;
  };
  assert.equal(call.reason, "HOURLY");
  assert.equal(call.limit, 100);
  assert.ok(call.staleBefore.getTime() >= before - 1_000);
  assert.deepEqual(call.connectorVersions, {
    XMLSTOCK: "xmlstock@test",
    ARSENKIN: "arsenkin@test",
    KEYS_SO: "keys_so@test"
  });
});

test("schedules an exact credential refresh after provider operation", async () => {
  let received: unknown;
  const broker = {
    scheduleValidationRefreshes: async (input: unknown) => {
      received = input;
      return [];
    }
  } as unknown as IntegrationCredentialExecutionBrokerService;
  const connectors = {
    version: (provider: IntegrationProvider) => `${provider.toLowerCase()}@test`
  } as unknown as IntegrationCredentialConnectorRegistry;
  const credentialId = "019fc000-0000-7000-8000-000000000002";

  await new IntegrationCredentialRefreshSchedulerService(
    broker,
    connectors
  ).scheduleAfterProviderOperation(credentialId);

  assert.deepEqual(received, {
    credentialIds: [credentialId],
    connectorVersions: {
      XMLSTOCK: "xmlstock@test",
      ARSENKIN: "arsenkin@test",
      KEYS_SO: "keys_so@test"
    },
    reason: "PROVIDER_OPERATION",
    limit: 1
  });
});
