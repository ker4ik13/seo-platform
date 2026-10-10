import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticSystemColumnKeys,
  semanticRankColumnKey,
  projectOnboardingDimensions,
} from "@seo-platform/contracts";
import {
  semanticColumnLabel,
  semanticSystemColumns,
} from "./semantic-column-presentation.ts";
import {
  newProjectOnboardingDraft,
  projectOnboardingSettings,
} from "./project-onboarding.ts";

test("shared headings cover every system column without changing semantic names", () => {
  assert.deepEqual(
    semanticSystemColumns.map(({ key }) => key),
    semanticSystemColumnKeys,
  );
  assert.equal(semanticColumnLabel("frequency"), "База");
  assert.equal(semanticColumnLabel("frequencyExact"), '""');
  assert.equal(semanticColumnLabel("frequencyFixed"), '"!"');
  assert.equal(semanticColumnLabel("query"), "Запрос");
  assert.equal(semanticColumnLabel("custom:deleted"), "Удалённая колонка");
  assert.equal(
    semanticColumnLabel("custom:one", [{ id: "one", name: "Своя колонка" }]),
    "Своя колонка",
  );
  assert.equal(
    semanticColumnLabel(
      "custom:one",
      [{ id: "one", name: "Запрос" }],
      [],
      "en",
    ),
    "Запрос",
    "user-defined names must never be translated or renamed",
  );
});

test("onboarding dimensions use the same localized geographic labels as semantic headers", () => {
  const dimensions = projectOnboardingDimensions(
    projectOnboardingSettings(newProjectOnboardingDraft()),
  );
  const dimension = dimensions[0];
  assert.ok(dimension);
  const column = semanticRankColumnKey(dimension.key, "position");
  assert.equal(
    semanticColumnLabel(column, [], dimensions),
    "Яндекс · Москва · ПК · Позиция",
  );
  assert.equal(
    semanticColumnLabel(column, [], dimensions, "en"),
    "Yandex · Москва · Desktop · Position",
  );
});
