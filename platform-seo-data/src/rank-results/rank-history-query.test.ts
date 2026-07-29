import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { rankHistoryQuery } from "./rank-history-query.js";

const trackingContextId =
  "01900000-0000-7000-8000-000000000001";

test("parses the bounded mandatory history window", () => {
  assert.deepEqual(
    rankHistoryQuery({
      observedFrom: "2026-07-01T00:00:00.000Z",
      observedBefore: "2026-08-01T00:00:00.000Z",
      trackingContextId,
      limit: "200"
    }),
    {
      observedFrom: "2026-07-01T00:00:00.000Z",
      observedBefore: "2026-08-01T00:00:00.000Z",
      trackingContextId,
      limit: 200
    }
  );
});

test("rejects missing, inverted and unbounded history queries", () => {
  for (const query of [
    {
      observedBefore: "2026-08-01T00:00:00.000Z",
      limit: 10
    },
    {
      observedFrom: "2026-08-01T00:00:00.000Z",
      observedBefore: "2026-08-01T00:00:00.000Z",
      limit: 10
    },
    {
      observedFrom: "2026-07-01T00:00:00.000Z",
      observedBefore: "2026-08-01T00:00:00.000Z",
      limit: 201
    },
    {
      observedFrom: "2026-07-01T00:00:00.000Z",
      observedBefore: "2026-08-01T00:00:00.000Z",
      limit: 10,
      workspaceId: trackingContextId
    }
  ]) {
    assert.throws(() => rankHistoryQuery(query), BadRequestException);
  }
});
