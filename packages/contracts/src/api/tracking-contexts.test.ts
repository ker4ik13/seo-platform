import assert from "node:assert/strict";
import test from "node:test";
import {
  trackingContextStatuses,
  trackingDepths,
  trackingDevices,
  trackingDomainMatchModes,
  trackingSearchEngines
} from "./tracking-contexts.js";

test("tracking context configuration uses finite versionable enums", () => {
  assert.deepEqual(trackingContextStatuses, ["ACTIVE", "ARCHIVED"]);
  assert.deepEqual(trackingSearchEngines, ["GOOGLE", "YANDEX"]);
  assert.deepEqual(trackingDevices, ["DESKTOP", "MOBILE"]);
  assert.deepEqual(trackingDepths, [10, 20, 30, 50, 100]);
  assert.deepEqual(trackingDomainMatchModes, [
    "EXACT_HOST",
    "INCLUDE_WWW",
    "INCLUDE_SUBDOMAINS",
    "CANONICAL_DOMAIN",
    "ANY_PROJECT_MIRROR",
    "SPECIFIC_URL",
    "URL_PREFIX"
  ]);
});
