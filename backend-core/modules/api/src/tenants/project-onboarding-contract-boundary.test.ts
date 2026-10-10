import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProjectOnboardingSettings,
  projectOnboardingColumnCatalog,
  projectOnboardingViewConfig,
} from "@seo-platform/contracts";
import { createSemanticSavedViewInput } from "../semantics/semantic-saved-view-input.js";
import { semanticSavedView } from "../seo-data/seo-data.client.js";

test("bootstrap full order crosses both strict owning-service consumers without widening visible columns", () => {
  const engine = {
    searchEngine: "YANDEX" as const,
    positions: true,
    ai: true,
    depth: 30 as const,
    targets: Array.from({ length: 64 }, (_, index) => ({
      regionCode: String(1000 + index),
      regionLabel: "Город " + index,
      device: "DESKTOP" as const,
    })),
  };
  const columnOrder = projectOnboardingColumnCatalog({ engines: [engine] });
  const profile = parseProjectOnboardingSettings({
    version: 1,
    engines: [engine],
    columns: ["query"],
    columnOrder,
  });
  const config = projectOnboardingViewConfig(profile);
  assert.ok(columnOrder.length > 128);
  assert.equal(
    createSemanticSavedViewInput({
      name: "Основное",
      scope: "PROJECT_SHARED",
      config,
    }).config.columnOrder!.length,
    columnOrder.length,
  );
  const id = "01900000-0000-7000-8000-000000000001";
  const response = semanticSavedView({
    id,
    ownerId: id,
    name: "Основное",
    scope: "PROJECT_SHARED",
    config,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(response.config.columnOrder!.length, columnOrder.length);
  assert.throws(() =>
    createSemanticSavedViewInput({
      name: "Основное",
      scope: "PROJECT_SHARED",
      config: { ...config, columns: columnOrder.slice(0, 129) },
    }),
  );
});
