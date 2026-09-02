import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { createRankEstimateInput } from "./rank-estimate-input.js";

const contextId = "01900000-0000-7000-8000-000000000101";
const credentialId = "01900000-0000-7000-8000-000000000102";

test("parses the one-context rank estimate command with an explicit provider", () => {
  assert.deepEqual(
    createRankEstimateInput({
      trackingContextId: contextId.toUpperCase(),
      provider: "XMLSTOCK",
      credentialId: credentialId.toUpperCase()
    }),
    {
      trackingContextId: contextId,
      provider: "XMLSTOCK",
      credentialId
    }
  );
});

test("accepts Turbo only for an explicit XMLStock Yandex Live estimate", () => {
  assert.deepEqual(
    createRankEstimateInput({
      trackingContextId: contextId,
      provider: "XMLSTOCK",
      credentialId,
      searchSource: "LIVE",
      yandexLiveMode: "TURBO"
    }),
    {
      trackingContextId: contextId,
      provider: "XMLSTOCK",
      credentialId,
      searchSource: "LIVE",
      yandexLiveMode: "TURBO"
    }
  );
  for (const value of [
    {
      trackingContextId: contextId,
      provider: "ARSENKIN",
      searchSource: "LIVE",
      yandexLiveMode: "TURBO"
    },
    {
      trackingContextId: contextId,
      provider: "XMLSTOCK",
      searchSource: "SEARCH_API",
      yandexLiveMode: "TURBO"
    }
  ]) {
    assert.throws(() => createRankEstimateInput(value), DomainError);
  }
});

test("accepts competitor SERP policy and rejects the position flag elsewhere", () => {
  assert.deepEqual(
    createRankEstimateInput({
      trackingContextId: contextId,
      purpose: "COMPETITOR_SERP",
      saveProjectPosition: true,
      provider: "ARSENKIN",
      searchSource: "LIVE"
    }),
    {
      trackingContextId: contextId,
      purpose: "COMPETITOR_SERP",
      saveProjectPosition: true,
      provider: "ARSENKIN",
      searchSource: "LIVE"
    }
  );
  assert.throws(
    () => createRankEstimateInput({
      trackingContextId: contextId,
      saveProjectPosition: false
    }),
    DomainError
  );
});

test("rejects unknown, missing and malformed estimate fields", () => {
  for (const value of [
    {},
    { trackingContextId: "not-a-uuid" },
    { trackingContextId: contextId, provider: "UNKNOWN" },
    { trackingContextId: contextId, credentialId: "not-a-uuid" },
    [contextId]
  ]) {
    assert.throws(
      () => createRankEstimateInput(value),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "VALIDATION_FAILED"
    );
  }
});
