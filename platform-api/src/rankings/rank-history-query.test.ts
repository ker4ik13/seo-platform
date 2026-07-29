import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { rankHistoryQuery } from "./rank-history-query.js";

const trackingContextId =
  "01900000-0000-7000-8000-000000000001";
const keywordId = "01900000-0000-7000-8000-000000000002";
const observedFrom = "2026-07-01T00:00:00.000Z";
const observedBefore = "2026-08-01T00:00:00.000Z";

test("parses a canonical bounded public rank-history query", () => {
  assert.deepEqual(
    rankHistoryQuery({
      observedFrom,
      observedBefore,
      trackingContextId: trackingContextId.toUpperCase(),
      keywordId: keywordId.toUpperCase(),
      cursor: "eyJjdXJzb3IiOiJvcGFxdWUifQ",
      limit: "200"
    }),
    {
      observedFrom,
      observedBefore,
      trackingContextId,
      keywordId,
      limit: 200,
      cursor: "eyJjdXJzb3IiOiJvcGFxdWUifQ"
    }
  );
  assert.deepEqual(
    rankHistoryQuery({ observedFrom, observedBefore }),
    {
      observedFrom,
      observedBefore,
      limit: 100
    }
  );
});

test("rejects missing, non-canonical and inverted history windows", () => {
  for (const query of [
    { observedBefore },
    { observedFrom, observedBefore: observedFrom },
    {
      observedFrom: "2026-07-01T00:00:00Z",
      observedBefore
    },
    {
      observedFrom,
      observedBefore: "2026-08-01T03:00:00.000+03:00"
    }
  ]) {
    assert.throws(() => rankHistoryQuery(query), DomainError);
  }
});

test("rejects ambiguous, unsupported and unbounded query parameters", () => {
  for (const query of [
    [],
    { observedFrom, observedBefore, workspaceId: trackingContextId },
    { observedFrom: [observedFrom], observedBefore },
    { observedFrom, observedBefore, trackingContextId: [trackingContextId] },
    { observedFrom, observedBefore, trackingContextId: keywordId.replace("-7", "-4") },
    { observedFrom, observedBefore, limit: "0" },
    { observedFrom, observedBefore, limit: "01" },
    { observedFrom, observedBefore, limit: "201" },
    { observedFrom, observedBefore, cursor: "not a base64url cursor" },
    { observedFrom, observedBefore, cursor: "a" },
    { observedFrom, observedBefore, cursor: "a".repeat(4097) }
  ]) {
    assert.throws(() => rankHistoryQuery(query), DomainError);
  }
});
