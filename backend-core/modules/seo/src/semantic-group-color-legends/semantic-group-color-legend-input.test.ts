import assert from "node:assert/strict";
import test from "node:test";
import {
  internalMarkSemanticGroupColorLegendSeenInput,
  internalUpdateSemanticGroupColorLegendInput
} from "./semantic-group-color-legend-input.js";

const scope = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
};

test("parses a first versioned legend update", () => {
  assert.deepEqual(
    internalUpdateSemanticGroupColorLegendInput({
      ...scope,
      canManage: true,
      version: 0,
      entries: [{ color: "#334155", note: "  Нужна перепроверка " }]
    }),
    {
      ...scope,
      canManage: true,
      version: 0,
      entries: [{ color: "#334155", note: "Нужна перепроверка" }]
    }
  );
});

test("rejects unsupported colors and overlong notes", () => {
  assert.throws(() => internalUpdateSemanticGroupColorLegendInput({
    ...scope,
    canManage: true,
    version: 1,
    entries: [{ color: "#ffffff", note: "Не из каталога" }]
  }));
  assert.throws(() => internalUpdateSemanticGroupColorLegendInput({
    ...scope,
    canManage: true,
    version: 1,
    entries: [{ color: "#ff0000", note: "а".repeat(241) }]
  }));
});

test("bounds seen receipts to a non-negative legend version", () => {
  assert.deepEqual(
    internalMarkSemanticGroupColorLegendSeenInput({ ...scope, version: 3 }),
    { ...scope, version: 3 }
  );
  assert.throws(() => internalMarkSemanticGroupColorLegendSeenInput({
    ...scope,
    version: -1
  }));
});
