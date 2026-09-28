import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationProviderMetadata,
  operationalIntegrationProviderCatalog,
  operationalIntegrationProviderCatalogForPlatform
} from "./integration-provider-catalog.js";

test("Arsenkin catalog exposes its documented execution capabilities", () => {
  assert.ok(
    integrationProviderMetadata("ARSENKIN").capabilities.includes(
      "SERP_RANK_TRACKING"
    )
  );
  assert.ok(
    integrationProviderMetadata("ARSENKIN").capabilities.includes(
      "CLUSTERING"
    )
  );
  assert.ok(
    integrationProviderMetadata("ARSENKIN").capabilities.includes(
      "KEYWORD_RESEARCH"
    )
  );
});
test("public catalog only advertises operational provider workflows", () => {
  assert.deepEqual(
    operationalIntegrationProviderCatalog.map(({ provider }) => provider),
    ["XMLSTOCK", "ARSENKIN", "KEYS_SO"]
  );
  assert.deepEqual(
    integrationProviderMetadata("ARSENKIN").capabilities,
    [
      "SERP_RANK_TRACKING",
      "SERP_COLLECTION",
      "WORDSTAT",
      "CLUSTERING",
      "KEYWORD_RESEARCH"
    ]
  );
  assert.deepEqual(
    integrationProviderMetadata("KEYS_SO").capabilities,
    ["KEYWORD_RESEARCH", "COMPETITOR_RESEARCH"]
  );
  assert.equal(
    integrationProviderMetadata("XMLSTOCK").credentialValidationMode,
    "ACCOUNT_METADATA"
  );
  assert.deepEqual(
    integrationProviderMetadata("XMLSTOCK").capabilities,
    ["SERP_RANK_TRACKING", "SERP_COLLECTION", "WORDSTAT", "KEYWORD_RESEARCH"]
  );
});

test("advertises platform-paid mode only for configured providers", () => {
  const catalog = operationalIntegrationProviderCatalogForPlatform(
    new Set(["XMLSTOCK"])
  );
  assert.deepEqual(
    catalog.find(({ provider }) => provider === "XMLSTOCK")?.supportedModes,
    ["BYOK_API_KEY", "PLATFORM_PAID"]
  );
  assert.deepEqual(
    catalog.find(({ provider }) => provider === "ARSENKIN")?.supportedModes,
    ["BYOK_API_KEY"]
  );
  assert.doesNotMatch(
    catalog.find(({ provider }) => provider === "XMLSTOCK")
      ?.description ?? "",
    /системное подключение/u
  );
});
