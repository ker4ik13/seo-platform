import assert from "node:assert/strict";
import test from "node:test";
import {
  processEnvironment,
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
