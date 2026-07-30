import assert from "node:assert/strict";
import test from "node:test";
import { EmailModule } from "../email/email.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { HealthModule } from "./health.module.js";

test("imports both optional adapter providers required by readiness", () => {
  const imports: unknown = Reflect.getMetadata("imports", HealthModule);

  assert.ok(Array.isArray(imports));
  assert.deepEqual(imports, [StorageModule, EmailModule]);
});
