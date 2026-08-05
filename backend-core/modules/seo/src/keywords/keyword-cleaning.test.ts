import assert from "node:assert/strict";
import test from "node:test";
import { cleanKeywordText } from "./keyword-cleaning.js";

test("applies explicit keyword cleaning rules in a stable order", () => {
  assert.equal(
    cleanKeywordText('  «Ёлки» — +ЦЕНА !Купить [Москва]  ', {
      collapseWhitespace: true,
      normalizeQuotes: true,
      normalizeDashes: true,
      normalizeYo: true,
      removeSearchOperators: true,
      letterCase: "LOWER"
    }),
    "елки - цена купить москва"
  );
});

test("does not apply unselected destructive rules", () => {
  assert.equal(
    cleanKeywordText("  Ёлки — +Цена  ", { normalizeDashes: true }),
    "  Ёлки - +Цена  "
  );
});
