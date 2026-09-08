import assert from "node:assert/strict";
import test from "node:test";
import { keywordTagChanges, uniqueKeywordTags } from "./keyword-tags.ts";

test("tags preserve commas, collapse whitespace and deduplicate case/Unicode", () => {
  assert.deepEqual(uniqueKeywordTags([" Спрос,  бренд ", "спрос, бренд", "ＡＢＣ", "abc", " ", "Настройки"]), ["Спрос, бренд", "ABC", "Настройки"]);
});
test("single edits emit only explicit additions/removals instead of replacing other tags", () => {
  assert.deepEqual(keywordTagChanges(["A", "Спрос, бренд", "Сохранить"], ["a", "Спрос, бренд", "Новый"]), { addTagNames: ["Новый"], removeTagNames: ["Сохранить"] });
  assert.deepEqual(keywordTagChanges(["A", "B"], ["b", "a"]), {});
  assert.deepEqual(keywordTagChanges([], ["Настройки"]), { addTagNames: ["Настройки"] });
  assert.deepEqual(keywordTagChanges(["Важный"], []), { removeTagNames: ["Важный"] });
});
