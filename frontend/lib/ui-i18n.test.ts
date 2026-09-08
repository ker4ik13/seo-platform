import assert from "node:assert/strict";
import test from "node:test";
import { normalizedUiLocale, translateUi } from "./ui-i18n.ts";
import { uiEnglish } from "./ui-translations.ts";

test("UI locale normalization and switching retain authored messages", () => {
  assert.equal(normalizedUiLocale("en-US"), "en");
  assert.equal(normalizedUiLocale("ru-RU"), "ru");
  assert.equal(normalizedUiLocale("unknown"), "ru");
  assert.equal(translateUi("en", "Настройки"), "Settings");
  assert.equal(translateUi("ru", "Настройки"), "Настройки");
});
test("interpolated project content is preserved literally, including whitespace and HTML-looking text", () => {
  const name = 'Настройки  <script>alert(1)</script> &quot; {1} $&';
  assert.equal(translateUi("en", "Группа «{0}» создана", [name]), `Group “${name}” created`);
  assert.equal(translateUi("ru", "Группа «{0}» создана", [name]), `Группа «${name}» создана`);
  assert.equal(translateUi("en", "A user phrase not in the UI catalog"), "A user phrase not in the UI catalog");
});
test("legacy formatted notices translate their template without translating the embedded group name", () => {
  assert.equal(translateUi("en", "Группа «Настройки  API» создана"), "Group “Настройки  API” created");
  assert.equal(translateUi("en", "Загружено 50 000 из 80 000"), "Loaded 50 000 of 80 000");
  assert.equal(translateUi("en", "Позиция 5"), "Position 5");
});
test("authored JSX entities are decoded before values are inserted", () => {
  assert.equal(translateUi("ru", "Я &quot;!&quot;"), 'Я "!"');
  assert.equal(translateUi("en", "Я &quot;!&quot;"), 'Yandex "!"');
  assert.equal(translateUi("en", "Группа «{0}» создана", ["&quot;"]), 'Group “&quot;” created');
});
test("all dictionary placeholders are preserved and very large messages bypass template matching", () => {
  for (const [source, english] of Object.entries(uiEnglish)) {
    const tokens = (value: string) => [...value.matchAll(/\{\d+\}/gu)].map(match => match[0]).sort();
    assert.deepEqual(tokens(english), tokens(source), source);
  }
  const huge = `Группа «${"я".repeat(20_000)}» создана`;
  assert.equal(translateUi("en", huge), huge);
});
