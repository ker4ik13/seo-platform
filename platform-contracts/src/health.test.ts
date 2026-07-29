import assert from "node:assert/strict";
import test from "node:test";
import { serviceNames } from "./health.js";

test("service catalog contains every backend boundary", () => {
  assert.deepEqual(serviceNames, [
    "platform-api",
    "seo-data",
    "jobs-integrations",
    "realtime"
  ]);
});
