import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSemanticViewConfig,
  isInternalSemanticViewName,
  isSemanticPersonalViewName,
  semanticFolderSortConfigFor,
  semanticFolderSortFor,
  semanticFolderSortViewName,
  semanticPersonalViewName,
  type SemanticSavedView,
  type SemanticKeywordSort
} from "../components/semantic-view-types.ts";

const baseView = (
  name: string,
  sort: SemanticKeywordSort,
  scope: SemanticSavedView["scope"] = "PRIVATE"
): SemanticSavedView => ({
  id: crypto.randomUUID(),
  ownerId: crypto.randomUUID(),
  scope,
  name,
  config: { ...defaultSemanticViewConfig, sort },
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z"
});

test("keeps a different private sort for root and every semantic folder", () => {
  const firstGroupId = crypto.randomUUID();
  const secondGroupId = crypto.randomUUID();
  const views = [
    baseView(semanticFolderSortViewName(), "TEXT_ASC"),
    baseView(semanticFolderSortViewName(firstGroupId), "PRIORITY_DESC"),
    baseView(semanticFolderSortViewName(secondGroupId), "SOURCE_ASC"),
    baseView(
      semanticFolderSortViewName(firstGroupId),
      "UPDATED_ASC",
      "PROJECT_SHARED"
    )
  ];

  assert.equal(semanticFolderSortFor(undefined, views), "TEXT_ASC");
  assert.equal(
    semanticFolderSortFor(firstGroupId, views),
    "PRIORITY_DESC"
  );
  assert.equal(
    semanticFolderSortFor(secondGroupId, views),
    "SOURCE_ASC"
  );
  assert.equal(
    semanticFolderSortFor(crypto.randomUUID(), views),
    "CREATED_DESC"
  );
});

test("hides technical layout and folder preferences from named saved views", () => {
  assert.equal(isInternalSemanticViewName("__project_table_layout__"), true);
  assert.equal(isInternalSemanticViewName(semanticFolderSortViewName()), true);
  assert.equal(
    isInternalSemanticViewName(semanticFolderSortViewName(crypto.randomUUID())),
    true
  );
  assert.equal(isInternalSemanticViewName("Мой рабочий вид"), false);
  assert.equal(isInternalSemanticViewName(semanticPersonalViewName), false);
  assert.equal(isSemanticPersonalViewName("  личное  "), true);
  assert.equal(isSemanticPersonalViewName("Командное"), false);
});

test("restores the exact city and device used by a folder rank sort", () => {
  const groupId = crypto.randomUUID();
  const dimension = "GOOGLE|RU|1011973|ru|MOBILE";
  const view = baseView(
    semanticFolderSortViewName(groupId),
    "RANK_POSITION_ASC"
  );
  const views = [{
    ...view,
    config: {
      ...view.config,
      schemaVersion: 4 as const,
      rankSortDimensionKey: dimension
    }
  }];
  assert.deepEqual(semanticFolderSortConfigFor(groupId, views), {
    sort: "RANK_POSITION_ASC",
    rankSortDimensionKey: dimension
  });
});
