import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { collectionResponse } from "./api-response.js";

const request = { id: "request-collection-page" } as FastifyRequest;

test("preserves an explicit cursor page without claiming a false total", () => {
  const response = collectionResponse(
    request,
    [{ id: "first" }],
    { hasNext: true, nextCursor: "opaque-next-cursor" }
  );

  assert.deepEqual(response, {
    data: [{ id: "first" }],
    page: { hasNext: true, nextCursor: "opaque-next-cursor" },
    meta: { requestId: "request-collection-page" }
  });
});

test("keeps the exact-total response for bounded non-paginated collections", () => {
  const response = collectionResponse(request, ["first", "second"]);

  assert.deepEqual(response.page, {
    hasNext: false,
    totalApprox: 2
  });
});
