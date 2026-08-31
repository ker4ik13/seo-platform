import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRankExecutionGrantNoStore,
  rankExecutionGrantRoutePattern,
  rankExecutionGrantSettlementRoutePattern
} from "./rank-execution-grant-http.js";

test("applies no-store only to every response from the exact grant route", () => {
  for (const scenario of [
    {
      method: "POST",
      route: rankExecutionGrantRoutePattern,
      expected: "no-store"
    },
    {
      method: "GET",
      route: rankExecutionGrantRoutePattern,
      expected: undefined
    },
    {
      method: "POST",
      route: rankExecutionGrantSettlementRoutePattern,
      expected: "no-store"
    },
    {
      method: "POST",
      route: "/internal/v1/other",
      expected: undefined
    }
  ]) {
    const headers = new Map<string, string>();
    applyRankExecutionGrantNoStore(
      {
        method: scenario.method,
        routeOptions: { url: scenario.route }
      },
      {
        header: (name, value) => {
          headers.set(name.toLowerCase(), value);
        }
      }
    );
    assert.equal(headers.get("cache-control"), scenario.expected);
  }
});
