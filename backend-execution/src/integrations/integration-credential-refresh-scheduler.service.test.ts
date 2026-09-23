import assert from "node:assert/strict";
import test from "node:test";
import type { IntegrationProvider } from "@seo-platform/contracts";
import { IntegrationCredentialRefreshSchedulerService } from "./integration-credential-refresh-scheduler.service.js";
import type { IntegrationCredentialExecutionBrokerService } from "./integration-credential-execution-broker.service.js";
import type { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";

test("schedules hourly read-only refreshes for every supported provider", async () => {
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

test("schedules an exact refresh after a provider operation", async () => {
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
  ).scheduleAfterProviderOperation(credentialId, "ARSENKIN");

  assert.deepEqual(received, {
    credentialIds: [credentialId],
    staleBefore: (received as { staleBefore: Date }).staleBefore,
    connectorVersions: {
      ARSENKIN: "arsenkin@test"
    },
    reason: "PROVIDER_OPERATION",
    limit: 1
  });
  assert.ok(
    (received as { staleBefore: Date }).staleBefore.getTime() <=
      Date.now() - 60 * 60 * 1_000 + 1_000
  );
});

test("refreshes XMLStock through its read-only account connector", async () => {
  let calls = 0;
  const broker = {
    scheduleValidationRefreshes: async () => {
      calls += 1;
      return [];
    }
  } as unknown as IntegrationCredentialExecutionBrokerService;
  const connectors = {
    version: (provider: IntegrationProvider) => `${provider.toLowerCase()}@test`
  } as unknown as IntegrationCredentialConnectorRegistry;

  await new IntegrationCredentialRefreshSchedulerService(
    broker,
    connectors
  ).scheduleAfterProviderOperation(
    "019fc000-0000-7000-8000-000000000002",
    "XMLSTOCK"
  );

  assert.equal(calls, 1);
});
