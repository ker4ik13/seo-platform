import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "./app-config.js";

test("uses the SEO service default port", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.port, 4001);
  assert.equal(config.nats.url, "nats://localhost:4222");
});
