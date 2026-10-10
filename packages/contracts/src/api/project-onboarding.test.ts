import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProjectOnboardingSettings,
  projectOnboardingColumnCatalog,
  projectOnboardingDimensions,
  projectOnboardingViewConfig,
} from "./project-onboarding.js";
import { semanticRankColumnKey } from "./rank-dimensions.js";

const engine = {
  searchEngine: "YANDEX" as const,
  positions: true,
  ai: true,
  depth: 30 as const,
  targets: [
    { regionCode: "213", regionLabel: "Москва", device: "DESKTOP" as const },
  ],
};
const dimension = projectOnboardingDimensions({ engines: [engine] })[0]!;
const position = semanticRankColumnKey(dimension.key, "position");
const aiPosition = semanticRankColumnKey(dimension.key, "aiPosition");
const settings = {
  version: 1,
  engines: [engine],
  columns: ["query", position, aiPosition],
  columnOrder: ["query", position, aiPosition],
};
test("onboarding creates precise geographic columns and no synthetic results", () => {
  const parsed = parseProjectOnboardingSettings(settings);
  assert.deepEqual(
    projectOnboardingViewConfig(parsed).columns,
    settings.columns,
  );
  assert.equal(
    projectOnboardingDimensions({ engines: [{ ...engine, depth: 100 }] })[0]
      ?.key,
    dimension.key,
  );
  assert.equal(
    projectOnboardingColumnCatalog({
      engines: [{ ...engine, ai: false }],
    }).includes(aiPosition),
    false,
  );
  assert.deepEqual(
    parseProjectOnboardingSettings({
      version: 1,
      engines: [],
      columns: ["query"],
      columnOrder: ["query"],
    }).engines,
    [],
  );
});
test("strict producer/consumer contract excludes secrets, identities and unreachable columns", () => {
  for (const value of [
    { ...settings, actorId: "untrusted" },
    { ...settings, engines: [{ ...engine, token: "secret" }] },
    { ...settings, engines: [{ ...engine, depth: 200 }] },
    {
      ...settings,
      engines: [{ ...engine, targets: [...engine.targets, ...engine.targets] }],
    },
    { ...settings, engines: [engine, engine] },
    {
      ...settings,
      columns: ["query", "custom:foreign"],
      columnOrder: ["query", "custom:foreign"],
    },
    { ...settings, engines: [{ ...engine, ai: false }] },
    {
      ...settings,
      columns: ["frequency", "query"],
      columnOrder: ["query", "frequency"],
    },
    { ...settings, columnOrder: ["query"] },
  ])
    assert.throws(() => parseProjectOnboardingSettings(value));
});
