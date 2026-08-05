import assert from "node:assert/strict";
import test from "node:test";
import {
  coreProcessProfile,
  withCoreProcessProfile
} from "./scoped-environment.js";

test("maps only profile-specific process conflicts and restores them", async () => {
  const original = {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    PORT: process.env.PORT,
    NATS_USER: process.env.NATS_USER,
    NATS_PASSWORD: process.env.NATS_PASSWORD
  };
  process.env.DATABASE_URL = "previous-database";
  process.env.PORT = "4999";
  delete process.env.DATABASE_POOL_MAX;
  delete process.env.NATS_USER;
  delete process.env.NATS_PASSWORD;
  try {
    const profile = coreProcessProfile(
      {
        PLATFORM_DATABASE_URL: "postgresql://core.invalid/app",
        PLATFORM_DATABASE_POOL_MAX: "17",
        PLATFORM_PORT: "4100",
        PLATFORM_NATS_USER: "publisher",
        PLATFORM_NATS_PASSWORD: "secret"
      },
      "PLATFORM",
      4000
    );
    await withCoreProcessProfile(profile, async () => {
      assert.equal(process.env.DATABASE_URL, profile.databaseUrl);
      assert.equal(process.env.DATABASE_POOL_MAX, "17");
      assert.equal(process.env.PORT, "4100");
      assert.equal(process.env.NATS_USER, "publisher");
      assert.equal(process.env.NATS_PASSWORD, "secret");
    });
    assert.equal(process.env.DATABASE_URL, "previous-database");
    assert.equal(process.env.PORT, "4999");
    assert.equal(process.env.DATABASE_POOL_MAX, undefined);
    assert.equal(process.env.NATS_USER, undefined);
    assert.equal(process.env.NATS_PASSWORD, undefined);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("requires an explicit database per core profile", () => {
  assert.throws(
    () => coreProcessProfile({}, "SEO", 4001),
    /SEO_DATABASE_URL is required/u
  );
});
