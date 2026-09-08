import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalChangeTrackingContextKeywordInput,
  internalCreateTrackingContextInput,
  internalReplaceTrackingContextKeywordsInput,
  trackingContextKeywordQuery
} from "./tracking-context-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";

test("normalizes a provider-neutral tracking context command", () => {
  const input = internalCreateTrackingContextInput({
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: " context-1 ",
    name: "  Москва   mobile ",
    configuration: {
      searchEngine: "YANDEX",
      countryCode: "ru",
      regionCode: " 213 ",
      regionLabel: "  Москва ",
      language: "ru-ru",
      device: "MOBILE",
      depth: 50,
      domainMatchRule: {
        mode: "URL_PREFIX",
        value: "HTTPS://EXAMPLE.COM:443/catalog#"
      },
      safeSearch: true
    }
  });

  assert.equal(input.idempotencyKey, "context-1");
  assert.equal(input.name, "Москва mobile");
  assert.equal(input.configuration.countryCode, "RU");
  assert.equal(input.configuration.language, "ru-RU");
  assert.equal(input.configuration.regionCode, "213");
  assert.deepEqual(input.configuration.domainMatchRule, {
    mode: "URL_PREFIX",
    value: "https://example.com/catalog"
  });
});

test("rejects unknown fields and inconsistent domain rules", () => {
  const base = {
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "context-1",
    name: "Desktop",
    configuration: {
      searchEngine: "GOOGLE",
      countryCode: "US",
      language: "en",
      device: "DESKTOP",
      depth: 100,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: false
    }
  };
  assert.throws(
    () => internalCreateTrackingContextInput({ ...base, provider: "x" }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateTrackingContextInput({
        ...base,
        configuration: {
          ...base.configuration,
          domainMatchRule: {
            mode: "EXACT_HOST",
            value: "https://example.com"
          }
        }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateTrackingContextInput({
        ...base,
        configuration: {
          ...base.configuration,
          regionLabel: "California"
        }
      }),
    BadRequestException
  );
});

test("bounds keyword queries and validates point command identifiers", () => {
  const entitlement = {
    planCode: "TEAM",
    planVersion: 1,
    storedKeywords: 2_000_000,
    keywordsPerProject: 2_000_000,
    foldersPerProject: 500,
    trackedContextPairs: 50_000
  } as const;
  assert.deepEqual(trackingContextKeywordQuery({}), { limit: 100 });
  assert.deepEqual(
    trackingContextKeywordQuery({ limit: "200", search: " seo " }),
    { limit: 200, search: "seo" }
  );
  assert.deepEqual(trackingContextKeywordQuery({ limit: "1000" }), {
    limit: 1000
  });
  assert.throws(
    () => trackingContextKeywordQuery({ limit: "1001" }),
    BadRequestException
  );
  assert.throws(
    () => trackingContextKeywordQuery({ sort: "name" }),
    BadRequestException
  );
  assert.deepEqual(
    internalChangeTrackingContextKeywordInput({
      workspaceId,
      projectId,
      actorId,
      contextId,
      keywordId,
      entitlement
    }),
    {
      workspaceId,
      projectId,
      actorId,
      contextId,
      keywordId,
      entitlement
    }
  );
});

test("validates an exact 15,000-keyword replacement command", () => {
  const keywordIds = keywordIdentifiers(15_000);
  const result = internalReplaceTrackingContextKeywordsInput({
    workspaceId,
    projectId,
    actorId,
    contextId,
    version: 7,
    idempotencyKey: "replace-keywords-001",
    keywordIds,
    entitlement: {
      planCode: "TEAM",
      planVersion: 1,
      storedKeywords: 2_000_000,
      keywordsPerProject: 2_000_000,
      foldersPerProject: 500,
      trackedContextPairs: 50_000
    }
  });

  assert.equal(result.keywordIds.length, 15_000);
  assert.equal(result.version, 7);
  assert.equal(result.idempotencyKey, "replace-keywords-001");
});

test("rejects a 300,001-keyword replacement before persistence", () => {
  assert.throws(
    () =>
      internalReplaceTrackingContextKeywordsInput({
        workspaceId,
        projectId,
        actorId,
        contextId,
        version: 1,
        idempotencyKey: "replace-keywords-001",
        keywordIds: keywordIdentifiers(300_001),
        entitlement: {
          planCode: "TEAM",
          planVersion: 1,
          storedKeywords: 2_000_000,
          keywordsPerProject: 2_000_000,
          foldersPerProject: 500,
          trackedContextPairs: 50_000
        }
      }),
    BadRequestException
  );
});

function keywordIdentifiers(count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`
  );
}
