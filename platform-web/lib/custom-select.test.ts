import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSelectOptions,
  nextSelectIndex,
  normalizeSelectSearchText
} from "./custom-select.ts";

test("filters custom select options by normalized visible text", () => {
  const options = [
    { disabled: false, searchText: "москва — 213", value: "213" },
    { disabled: false, searchText: "санкт-петербург — 2", value: "2" }
  ];

  assert.deepEqual(filterSelectOptions(options, "  МОСКВА "), [options[0]]);
  assert.equal(normalizeSelectSearchText("  Санкт   Петербург "), "санкт петербург");
});

test("keyboard navigation skips disabled options and wraps", () => {
  const options = [
    { disabled: false },
    { disabled: true },
    { disabled: false }
  ];

  assert.equal(nextSelectIndex(options, 0, 1), 2);
  assert.equal(nextSelectIndex(options, 2, 1), 0);
  assert.equal(nextSelectIndex(options, 0, -1), 2);
  assert.equal(nextSelectIndex([{ disabled: true }], -1, 1), -1);
});
