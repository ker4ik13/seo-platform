import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createTrackingContextInput,
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
});

test("rejects unknown, ambiguous and unbounded query values", () => {
  assert.throws(
    () => trackingContextKeywordQuery({ limit: ["10", "20"] }),
    DomainError
  );
  assert.throws(
    () => trackingContextKeywordQuery({ limit: "201" }),
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
