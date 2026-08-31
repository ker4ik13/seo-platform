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
  WEB_PUSH_VAPID_PRIVATE_KEY: "private-value",
  OPERATIONAL_ALERT_TOKEN: "operational-token",
  TELEGRAM_ALERT_BOT_TOKEN: "bot-secret",
  JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN:
    "billing-settlement-secret",
  PLATFORM_ARSENKIN_ENABLED: "true",
  PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "25",
  PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "1000",
  PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "10000",
  PLATFORM_XMLSTOCK_ENABLED: "false",
  PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "30"
} satisfies NodeJS.ProcessEnv;

test("core runtime exposes realtime credentials only to realtime", () => {
  const definitions = coreProcessDefinitions(baseEnvironment);
  assert.deepEqual(definitions.map(({ name }) => name), [
    "alerts",
    "http",
    "realtime"
  ]);
  assert.equal(
    definitions[0]?.environment.OPERATIONAL_ALERT_TOKEN,
    "operational-token"
  );
  assert.equal(
    definitions[0]?.environment.TELEGRAM_ALERT_BOT_TOKEN,
    "bot-secret"
  );
  assert.equal(definitions[1]?.environment.OPERATIONAL_ALERT_TOKEN, undefined);
  assert.equal(definitions[1]?.environment.TELEGRAM_ALERT_BOT_TOKEN, undefined);
  assert.equal(definitions[1]?.environment.PLATFORM_ARSENKIN_ENABLED, "true");
  assert.equal(
    definitions[1]?.environment.JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN,
    "billing-settlement-secret"
  );
  assert.equal(
    definitions[1]?.environment.PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR,
    "25"
  );
  assert.equal(
    definitions[1]?.environment.PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR,
    "1000"
  );
  assert.equal(
    definitions[1]?.environment.PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR,
    "10000"
  );
  assert.equal(definitions[0]?.environment.PLATFORM_ARSENKIN_ENABLED, undefined);
  assert.equal(definitions[2]?.environment.PLATFORM_ARSENKIN_ENABLED, undefined);
  assert.equal(
    definitions[0]?.environment.PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR,
    undefined
  );
  assert.equal(
    definitions[2]?.environment.PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR,
    undefined
  );
  assert.equal(
    definitions[0]?.environment.JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN,
    undefined
  );
  assert.equal(
    definitions[2]?.environment.JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN,
    undefined
  );
  assert.equal(definitions[1]?.environment.DATABASE_URL, undefined);
  assert.equal(
    definitions[2]?.environment.DATABASE_URL,
    "postgresql://realtime"
  );
  assert.equal(
    definitions[2]?.environment.WEB_PUSH_VAPID_PRIVATE_KEY,
    undefined
  );
});

test("web push role is opt-in and receives its dedicated database", () => {
  const definitions = coreProcessDefinitions({
    ...baseEnvironment,
    WEB_PUSH_DELIVERY_ENABLED: "true",
    WEB_PUSH_DATABASE_URL: "postgresql://web-push"
  });
  assert.equal(definitions[3]?.name, "web-push");
  assert.equal(
    definitions[3]?.environment.DATABASE_URL,
    "postgresql://web-push"
  );
  assert.equal(
    definitions[3]?.environment.WEB_PUSH_VAPID_PRIVATE_KEY,
    "private-value"
  );
});
