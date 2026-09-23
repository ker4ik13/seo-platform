import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createTrackingContextInput,
  replaceTrackingContextKeywordsInput,
  trackingContextKeywordQuery,
  updateTrackingContextInput
} from "./tracking-context-input.js";

const validInput = {
  name: "  Москва · mobile  ",
  configuration: {
    searchEngine: "YANDEX",
    countryCode: "ru",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "MOBILE",
    depth: 100,
    domainMatchRule: {
      mode: "URL_PREFIX",
      value: "https://example.com/catalog/"
    },
    safeSearch: false
  }
} as const;

test("normalizes a complete tracking context command", () => {
  const result = createTrackingContextInput(validInput);

  assert.equal(result.name, "Москва · mobile");
  assert.equal(result.configuration.countryCode, "RU");
  assert.equal(result.configuration.language, "ru");
  assert.deepEqual(result.configuration.domainMatchRule, {
    mode: "URL_PREFIX",
    value: "https://example.com/catalog/"
  });
  assert.deepEqual(updateTrackingContextInput(validInput), result);
});

test("accepts a non-reusable context only when creating", () => {
  assert.equal(
    createTrackingContextInput({ ...validInput, isReusable: false }).isReusable,
    false
  );
  assert.throws(
    () => updateTrackingContextInput({ ...validInput, isReusable: false }),
    DomainError
  );
});

test("normalizes the explicit untracked launch override and defaults legacy input", () => {
  const explicit = createTrackingContextInput({
    ...validInput,
    launchProfile: {
      searchSource: "LIVE",
      includeUntracked: true,
      scope: { mode: "ALL", groupIds: [] }
    }
  });
  assert.equal(explicit.launchProfile?.includeUntracked, true);
  assert.deepEqual(explicit.launchProfile?.scope.descendantGroupIds, []);

  const legacy = createTrackingContextInput({
    ...validInput,
    launchProfile: {
      searchSource: "LIVE",
      scope: { mode: "ALL", groupIds: [] }
    }
  });
  assert.equal(legacy.launchProfile?.includeUntracked, false);
  assert.deepEqual(legacy.launchProfile?.scope.descendantGroupIds, []);
});

test("persists XMLStock depth and Turbo defaults in a tracking context", () => {
  const result = createTrackingContextInput({
    ...validInput,
    launchProfile: {
      searchSource: "LIVE",
      yandexLiveMode: "TURBO",
      xmlStockDepthMode: "STOP_AFTER_FOUND",
      includeUntracked: false,
      scope: { mode: "ALL", groupIds: [] }
    }
  });
  assert.equal(result.launchProfile?.yandexLiveMode, "TURBO");
  assert.equal(
    result.launchProfile?.xmlStockDepthMode,
    "STOP_AFTER_FOUND"
  );
  assert.throws(
    () => createTrackingContextInput({
      ...validInput,
      launchProfile: {
        searchSource: "LIVE",
        yandexLiveMode: "FAST",
        xmlStockDepthMode: "FIRST_PAGE",
        scope: { mode: "ALL", groupIds: [] }
      }
    }),
    DomainError
  );
});

test("keeps descendant expansion as an explicit folder choice", () => {
  const groupId = "01900000-0000-7000-8000-000000000099";
  const directGroupId = "01900000-0000-7000-8000-000000000098";
  const result = createTrackingContextInput({
    ...validInput,
    launchProfile: {
      searchSource: "LIVE",
      includeUntracked: false,
      scope: {
        mode: "GROUPS",
        groupIds: [groupId],
        includeDescendants: true
      }
    }
  });

  assert.deepEqual(result.launchProfile?.scope, {
    mode: "GROUPS",
    groupIds: [groupId],
    descendantGroupIds: [groupId]
  });
  assert.deepEqual(createTrackingContextInput({
    ...validInput,
    launchProfile: {
      searchSource: "LIVE",
      scope: {
        mode: "GROUPS",
        groupIds: [groupId, directGroupId],
        descendantGroupIds: [groupId]
      }
    }
  }).launchProfile?.scope, {
    mode: "GROUPS",
    groupIds: [groupId, directGroupId],
    descendantGroupIds: [groupId]
  });
  assert.throws(
    () => createTrackingContextInput({
      ...validInput,
      launchProfile: {
        searchSource: "LIVE",
        scope: {
          mode: "ALL",
          groupIds: [],
          includeDescendants: true
        }
      }
    }),
    DomainError
  );
});

test("accepts a matching mode without a URL value", () => {
  const result = createTrackingContextInput({
    ...validInput,
    configuration: {
      ...validInput.configuration,
      regionCode: undefined,
      regionLabel: undefined,
      domainMatchRule: { mode: "INCLUDE_SUBDOMAINS" }
    }
  });

  assert.deepEqual(result.configuration.domainMatchRule, {
    mode: "INCLUDE_SUBDOMAINS"
  });
});

test("rejects unknown fields and inconsistent context values", () => {
  assert.throws(
    () =>
      createTrackingContextInput({
        ...validInput,
        provider: "ARSENKIN"
      }),
    DomainError
  );
  assert.throws(
    () =>
      createTrackingContextInput({
        ...validInput,
        configuration: {
          ...validInput.configuration,
          regionCode: undefined,
          regionLabel: "Москва"
        }
      }),
    DomainError
  );
  assert.throws(
    () =>
      createTrackingContextInput({
        ...validInput,
        configuration: {
          ...validInput.configuration,
          domainMatchRule: {
            mode: "SPECIFIC_URL",
            value: "https://user:password@example.com/#secret"
          }
        }
      }),
    DomainError
  );
});

test("parses a bounded assigned-keyword query", () => {
  assert.deepEqual(
    trackingContextKeywordQuery({
      limit: "25",
      search: "  SEO аудит  "
    }),
    { limit: 25, search: "SEO аудит" }
  );
  assert.deepEqual(trackingContextKeywordQuery(undefined), {
    limit: 100
  });
  assert.deepEqual(trackingContextKeywordQuery({ limit: "1000" }), {
    limit: 1000
  });
});

test("rejects unknown, ambiguous and unbounded query values", () => {
  assert.throws(
    () => trackingContextKeywordQuery({ limit: ["10", "20"] }),
    DomainError
  );
  assert.throws(
    () => trackingContextKeywordQuery({ limit: "1001" }),
    DomainError
  );
  assert.throws(
    () => trackingContextKeywordQuery({ cursor: "not a cursor" }),
    DomainError
  );
  assert.throws(
    () => trackingContextKeywordQuery({ extra: "field" }),
    DomainError
  );
});

test("accepts exactly 15,000 unique keyword identifiers for atomic replacement", () => {
  const keywordIds = keywordIdentifiers(15_000);
  const result = replaceTrackingContextKeywordsInput({ keywordIds });

  assert.equal(result.keywordIds.length, 15_000);
  assert.equal(result.keywordIds[0], keywordIds[0]);
  assert.equal(result.keywordIds.at(-1), keywordIds.at(-1));
});

test("rejects replacement overflow and duplicate identifiers", () => {
  assert.throws(
    () =>
      replaceTrackingContextKeywordsInput({
        keywordIds: keywordIdentifiers(300_001)
      }),
    DomainError
  );
  assert.throws(
    () =>
      replaceTrackingContextKeywordsInput({
        keywordIds: [
          "01900000-0000-7000-8000-000000000001",
          "01900000-0000-7000-8000-000000000001"
        ]
      }),
    DomainError
  );
});

function keywordIdentifiers(count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`
  );
}
