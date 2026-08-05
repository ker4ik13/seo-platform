import assert from "node:assert/strict";
import test from "node:test";
import { processEnvironment } from "./index.js";

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
