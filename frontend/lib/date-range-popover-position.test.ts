import assert from "node:assert/strict";
import test from "node:test";
import { dateRangePopoverPosition } from "./date-range-popover-position.ts";

const viewport = { left: 0, top: 0, width: 1440, height: 1000 };
test("calendar at the bottom of an export modal opens above without expanding the form", () => {
  const position = dateRangePopoverPosition({ anchor: { left: 130, top: 750, bottom: 786 }, height: 500, viewport, mode: "ANCHORED" });
  assert.equal(position.top, 242);
  assert.equal(position.left, 130);
  assert.equal(position.width, 640);
  assert.ok(position.top + 500 < 750);
});
test("calendar opens below when space is available and stays inside the right edge", () => {
  const position = dateRangePopoverPosition({ anchor: { left: 1300, top: 100, bottom: 134 }, height: 500, viewport, mode: "ANCHORED" });
  assert.equal(position.top, 142);
  assert.equal(position.left, 788);
});
test("short viewports limit the calendar itself, including visual viewport offsets", () => {
  const position = dateRangePopoverPosition({ anchor: { left: 50, top: 170, bottom: 200 }, height: 550,
    viewport: { left: 5, top: 100, width: 320, height: 300 }, mode: "SHEET" });
  assert.deepEqual(position, { width: 296, maxHeight: 276, left: 17, top: 112 });
});
test("explicit modal calendars stay centered", () => {
  const position = dateRangePopoverPosition({ anchor: { left: 0, top: 0, bottom: 20 }, height: 500, viewport, mode: "CENTERED" });
  assert.equal(position.left, 400);
  assert.equal(position.top, 250);
});
