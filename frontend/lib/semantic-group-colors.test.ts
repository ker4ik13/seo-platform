import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticGroupColors,
  semanticGroupDefaultColor
} from "./semantic-group-colors.ts";

test("shares one stable group palette between the tree and edit dialog", () => {
  assert.equal(semanticGroupColors.length, 8);
  assert.equal(
    new Set(semanticGroupColors.map(({ value }) => value)).size,
    semanticGroupColors.length
  );
  assert.equal(
    semanticGroupColors.some(({ value }) => value === semanticGroupDefaultColor),
    true
  );
  assert.equal(
    semanticGroupColors.every(({ value }) => /^#[0-9a-f]{6}$/u.test(value)),
    true
  );
});
