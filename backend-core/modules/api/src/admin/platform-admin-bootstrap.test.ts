import assert from "node:assert/strict";
import test from "node:test";
import { platformAdminBootstrapInput } from "./platform-admin-bootstrap.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  PLATFORM_DATABASE_URL: "postgresql://platform:secret@postgres:5432/platform",
  ADMIN_BOOTSTRAP_EMAIL: " Owner@Example.Test ",
  ADMIN_BOOTSTRAP_REASON: " Initial production operations owner ",
  ADMIN_BOOTSTRAP_CONFIRM: "CREATE_FIRST_SUPER_ADMIN"
};

test("accepts the production platform database variable", () => {
  assert.deepEqual(platformAdminBootstrapInput(baseEnvironment), {
    databaseUrl: "postgresql://platform:secret@postgres:5432/platform",
    email: "owner@example.test",
    reason: "Initial production operations owner"
  });
});

test("prefers an explicit migration-compatible database variable", () => {
  assert.equal(
    platformAdminBootstrapInput({
      ...baseEnvironment,
      DATABASE_URL: "postgresql://admin:secret@postgres:5432/platform"
    }).databaseUrl,
    "postgresql://admin:secret@postgres:5432/platform"
  );
});

test("requires the destructive bootstrap confirmation", () => {
  assert.throws(
    () =>
      platformAdminBootstrapInput({
        ...baseEnvironment,
        ADMIN_BOOTSTRAP_CONFIRM: "wrong"
      }),
    /ADMIN_BOOTSTRAP_CONFIRM/u
  );
});
