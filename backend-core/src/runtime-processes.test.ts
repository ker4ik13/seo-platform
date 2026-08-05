import assert from "node:assert/strict";
import test from "node:test";
import { coreProcessDefinitions } from "./runtime-processes.js";

const baseEnvironment = {
  NODE_ENV: "production",
  PLATFORM_DATABASE_URL: "postgresql://platform",
  SEO_DATABASE_URL: "postgresql://seo",
  REALTIME_DATABASE_URL: "postgresql://realtime",
  REALTIME_REDIS_URL: "redis://realtime",
  REALTIME_NATS_USER: "realtime-user",
  REALTIME_NATS_PASSWORD: "realtime-password",
  WEB_PUSH_VAPID_PRIVATE_KEY: "private-value"
} satisfies NodeJS.ProcessEnv;

test("core runtime exposes realtime credentials only to realtime", () => {
  const definitions = coreProcessDefinitions(baseEnvironment);
  assert.deepEqual(definitions.map(({ name }) => name), ["http", "realtime"]);
  assert.equal(definitions[0]?.environment.DATABASE_URL, undefined);
  assert.equal(
    definitions[1]?.environment.DATABASE_URL,
    "postgresql://realtime"
  );
  assert.equal(
    definitions[1]?.environment.WEB_PUSH_VAPID_PRIVATE_KEY,
    undefined
  );
});

test("web push role is opt-in and receives its dedicated database", () => {
  const definitions = coreProcessDefinitions({
    ...baseEnvironment,
    WEB_PUSH_DELIVERY_ENABLED: "true",
    WEB_PUSH_DATABASE_URL: "postgresql://web-push"
  });
  assert.equal(definitions[2]?.name, "web-push");
  assert.equal(
    definitions[2]?.environment.DATABASE_URL,
    "postgresql://web-push"
  );
  assert.equal(
    definitions[2]?.environment.WEB_PUSH_VAPID_PRIVATE_KEY,
    "private-value"
  );
});
