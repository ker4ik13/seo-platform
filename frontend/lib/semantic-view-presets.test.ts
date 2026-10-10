import assert from "node:assert/strict";
import test from "node:test";
import { applySemanticViewPreset } from "./semantic-view-presets.ts";
import { defaultSemanticViewConfig } from "../components/semantic-view-types.ts";

test("presentation presets preserve filters, widths and custom columns without enabling hidden defaults", () => {
  const original = { ...defaultSemanticViewConfig, filters: { search: "my keyword", targetUrlState: "SET" as const },
    columns: ["query", "custom:018e6f70-0000-7000-8000-000000000001"] as const, columnWidths: { query: 333 } };
  const result = applySemanticViewPreset(original, "WORDSTAT", []);
  assert.equal(result.filters, original.filters);
  assert.equal(result.columnWidths, original.columnWidths);
  assert.equal(result.sort, original.sort);
  assert.ok(result.columns.includes(original.columns[1]));
  assert.equal(result.columns.includes("wordCount"), false);
  assert.equal(result.columns.includes("group"), false);
});
