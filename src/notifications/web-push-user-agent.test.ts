import assert from "node:assert/strict";
import test from "node:test";
import { webPushUserAgentMetadata } from "./web-push-user-agent.js";

test("normalizes browser and platform without accepting client body metadata", () => {
  assert.deepEqual(
    webPushUserAgentMetadata(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
    ),
    { browser: "CHROME", platform: "MACOS" }
  );
  assert.deepEqual(
    webPushUserAgentMetadata(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0"
    ),
    { browser: "EDGE", platform: "WINDOWS" }
  );
  assert.deepEqual(
    webPushUserAgentMetadata(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) " +
        "AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
    ),
    { browser: "SAFARI", platform: "IOS" }
  );
});

test("uses bounded neutral metadata for an absent or unknown user agent", () => {
  assert.deepEqual(webPushUserAgentMetadata(undefined), {
    browser: "OTHER",
    platform: "OTHER"
  });
});
