import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { adminProjectIds } from "./platform-admin-read-input.js";

const firstProjectId = "01900000-0000-7000-8000-000000000001";
const secondProjectId = "01900000-0000-7000-8000-000000000002";

test("accepts a unique bounded platform project selection", () => {
  assert.deepEqual(adminProjectIds({ projectIds: [firstProjectId, secondProjectId] }), [
    firstProjectId,
    secondProjectId
  ]);
});

test("rejects empty, duplicate and malformed project selections", () => {
  for (const value of [
    {},
    { projectIds: [] },
    { projectIds: [firstProjectId, firstProjectId] },
    { projectIds: ["not-a-uuid"] },
    { projectIds: [firstProjectId], extra: true }
  ]) {
    assert.throws(() => adminProjectIds(value), BadRequestException);
  }
});
