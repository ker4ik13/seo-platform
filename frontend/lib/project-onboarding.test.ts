import assert from "node:assert/strict";
import test from "node:test";
import {
  newProjectOnboardingDraft,
  onboardingColumnSelection,
  projectOnboardingSettings,
  projectOnboardingDraftKey,
  readProjectOnboardingDraft,
  projectOnboardingFields,
} from "./project-onboarding.ts";
import {
  onboardingRunPreference,
  readProjectRunPreference,
  writeProjectRunPreference,
} from "./project-run-defaults.ts";
import { projectChartDefaultTops } from "./project-chart-defaults.ts";
import { projectOnboardingDimensions } from "@seo-platform/contracts";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
test("defaults exclude WS/group/tags/source and change order without duplicate columns", () => {
  const draft = newProjectOnboardingDraft(),
    initial = onboardingColumnSelection(draft);
  for (const key of ["wordCount", "group", "tags", "source"])
    assert.equal(initial.columns.includes(key as never), false);
  assert.equal(initial.columns.length, 5);
  const changed = projectOnboardingSettings({
    ...draft,
    columnOrder: ["query", "frequencyFixed", "frequency", "frequencyExact"],
    urls: true,
  });
  assert.deepEqual(changed.columns.slice(0, 4), [
    "query",
    "frequencyFixed",
    "frequency",
    "frequencyExact",
  ]);
  assert.equal(changed.columns.length, 6);
  assert.ok(
    projectOnboardingFields({
      ...draft,
      name: "",
      domain: "https://x.test/path",
    }).domain,
  );
});
test("saved creation drafts and pending commands are user/workspace scoped", () => {
  const local = storage(),
    draft = {
      ...newProjectOnboardingDraft(),
      name: "Сайт",
      domain: "site.test",
      step: 3 as const,
    };
  local.setItem(
    projectOnboardingDraftKey("actor-a", "workspace-a"),
    JSON.stringify(draft),
  );
  assert.equal(
    readProjectOnboardingDraft(local, "actor-a", "workspace-a")?.name,
    "Сайт",
  );
  assert.equal(
    readProjectOnboardingDraft(local, "actor-b", "workspace-a"),
    undefined,
  );
  assert.equal(
    readProjectOnboardingDraft(local, "actor-a", "workspace-b"),
    undefined,
  );
});
test("accepted run settings override onboarding only for the same actor/project/engine", () => {
  const local = storage(),
    settings = projectOnboardingSettings(newProjectOnboardingDraft());
  const planned = onboardingRunPreference(settings, "positions")!;
  assert.equal(planned.depth, 30);
  writeProjectRunPreference(local, "project-a", "actor-a", "positions", {
    ...planned,
    depth: 100,
  });
  assert.equal(
    readProjectRunPreference(local, "project-a", "actor-a", "positions")?.depth,
    100,
  );
  assert.equal(
    readProjectRunPreference(local, "project-a", "actor-b", "positions"),
    undefined,
  );
  assert.equal(
    readProjectRunPreference(local, "project-b", "actor-a", "positions"),
    undefined,
  );
  const key = projectOnboardingDimensions(settings)[0]!.key;
  assert.deepEqual(
    projectChartDefaultTops(settings, key, "project-a", "actor-b", local),
    [1, 3, 5, 10, 30],
  );
  assert.deepEqual(
    projectChartDefaultTops(settings, key, "project-a", "actor-a", local),
    [1, 3, 5, 10, 30, 50, 100],
  );
});
