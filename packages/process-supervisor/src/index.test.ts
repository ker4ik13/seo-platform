import assert from "node:assert/strict";
import test from "node:test";
import {
  processEnvironment,
  supervisedErrorContext,
  supervisedErrorExcerpt,
  supervisedErrorLineFingerprint
} from "./index.js";

test("processEnvironment exposes only base, allowed and overridden values", () => {
  const environment = processEnvironment(
    {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://allowed",
      FORBIDDEN_SECRET: "must-not-leak"
    },
    ["DATABASE_URL"],
    { PORT: "4000" }
  );

  assert.deepEqual(environment, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://allowed",
    PORT: "4000"
  });
});

test("rank persistence diagnostic adds only validated opaque project IDs", () => {
  const workspaceId = "01900000-0000-7000-8000-000000000001";
  const projectId = "01900000-0000-7000-8000-000000000002";
  const jobId = "01900000-0000-7000-8000-000000000003";
  const context = supervisedErrorContext(
    `ERROR rank_result_persist_failed workspaceId=${workspaceId} projectId=${projectId} jobId=${jobId} errorCode=P2010`
  );
  assert.equal(context.workspaceId, workspaceId);
  assert.equal(context.projectId, projectId);
  assert.equal(context.jobId, jobId);
  assert.equal(context.errorCode, "P2010");
  assert.deepEqual(
    Object.keys(supervisedErrorContext("ERROR token=private rank result failed")),
    ["log"]
  );
});

test("error-line observation emits only an irreversible fingerprint", () => {
  const secret = "provider-secret-that-must-never-leave-stderr";
  const fingerprint = supervisedErrorLineFingerprint(
    `[Nest] ERROR provider failed token=${secret}`
  );

  assert.match(fingerprint ?? "", /^[a-f0-9]{16}$/u);
  assert.equal(fingerprint?.includes(secret), false);
  assert.equal(
    supervisedErrorLineFingerprint("request completed successfully"),
    undefined
  );
});

test("Telegram diagnostic excerpt stays useful without secrets or personal data", () => {
  const excerpt = supervisedErrorExcerpt(
    "ERROR request failed DATABASE_PASSWORD=private-value user@example.test postgresql://user:password@db/private"
  );
  assert.match(excerpt, /^ERROR request failed/u);
  assert.match(excerpt, /\[redacted-secret\]/u);
  assert.match(excerpt, /\[redacted-email\]/u);
  assert.match(excerpt, /\[redacted-url\]/u);
  assert.doesNotMatch(excerpt, /private-value|user@example|password@/u);
  assert.ok(excerpt.length <= 128);
});
