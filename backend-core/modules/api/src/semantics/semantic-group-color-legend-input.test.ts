import assert from "node:assert/strict";
import test from "node:test";
import {
  markSemanticGroupColorLegendSeenInput,
  requiredSemanticGroupColorLegendVersion,
  updateSemanticGroupColorLegendInput
} from "./semantic-group-color-legend-input.js";

test("normalizes a bounded fixed-palette color legend", () => {
  assert.deepEqual(
    updateSemanticGroupColorLegendInput({
      entries: [
        { color: "#ff0000", note: "  Ждёт   сбора позиций  " },
        { color: "#0f766e", note: "Пересобрать семантику" }
      ]
    }),
    {
      entries: [
        { color: "#ff0000", note: "Ждёт сбора позиций" },
        { color: "#0f766e", note: "Пересобрать семантику" }
      ]
    }
  );
});

test("rejects duplicate, custom and empty legend entries", () => {
  assert.throws(() => updateSemanticGroupColorLegendInput({
    entries: [
      { color: "#ff0000", note: "Один" },
      { color: "#ff0000", note: "Два" }
    ]
  }));
  assert.throws(() => updateSemanticGroupColorLegendInput({
    entries: [{ color: "#abcdef", note: "Не из палитры" }]
  }));
  assert.throws(() => updateSemanticGroupColorLegendInput({
    entries: [{ color: "#ff0000", note: " " }]
  }));
});

test("accepts virtual version zero only for legend creation and seen state", () => {
  assert.equal(requiredSemanticGroupColorLegendVersion('"v0"'), 0);
  assert.deepEqual(markSemanticGroupColorLegendSeenInput({ version: 0 }), {
    version: 0
  });
  assert.throws(() => requiredSemanticGroupColorLegendVersion('"v-1"'));
});
