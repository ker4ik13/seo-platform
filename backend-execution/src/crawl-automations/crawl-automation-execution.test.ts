import assert from "node:assert/strict";
import test from "node:test";
import { withinAllowedWindow } from "./crawl-automation-execution.service.js";

test("evaluates quiet windows in the configured IANA timezone", () => {
  assert.equal(
    withinAllowedWindow(
      new Date("2026-07-31T03:30:00.000Z"),
      "Europe/Moscow",
      360,
      1_380
    ),
    true
  );
  assert.equal(
    withinAllowedWindow(
      new Date("2026-07-31T02:59:00.000Z"),
      "Europe/Moscow",
      360,
      1_380
    ),
    false
  );
  assert.equal(
    withinAllowedWindow(
      new Date("2026-07-31T20:00:00.000Z"),
      "Europe/Moscow",
      360,
      1_380
    ),
    false
  );
});
