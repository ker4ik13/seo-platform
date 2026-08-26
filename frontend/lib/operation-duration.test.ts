import assert from "node:assert/strict";
import test from "node:test";
import { operationDurationLabel } from "./operation-duration.ts";

test("operationDurationLabel returns nothing for an active operation", () => {
  assert.equal(
    operationDurationLabel({ createdAt: "2026-08-26T10:00:00.000Z" }),
    undefined
  );
});

test("operationDurationLabel uses startedAt when it is available", () => {
  assert.equal(
    operationDurationLabel({
      createdAt: "2026-08-26T09:50:00.000Z",
      startedAt: "2026-08-26T10:00:00.000Z",
      finishedAt: "2026-08-26T10:02:07.000Z"
    }),
    "2 минуты 7 сек"
  );
});

test("operationDurationLabel falls back to createdAt for legacy operations", () => {
  assert.equal(
    operationDurationLabel({
      createdAt: "2026-08-26T10:00:00.000Z",
      finishedAt: "2026-08-26T11:03:00.000Z"
    }),
    "1 час 3 мин"
  );
});

test("operationDurationLabel ignores invalid or negative intervals", () => {
  assert.equal(
    operationDurationLabel({
      createdAt: "invalid",
      finishedAt: "2026-08-26T11:03:00.000Z"
    }),
    undefined
  );
  assert.equal(
    operationDurationLabel({
      createdAt: "2026-08-26T12:00:00.000Z",
      finishedAt: "2026-08-26T11:03:00.000Z"
    }),
    undefined
  );
});
