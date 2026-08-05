import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSemanticViewConfig,
  isInternalSemanticViewName,
  semanticFolderSortFor,
  semanticFolderSortViewName,
  type SemanticSavedView,
  type SemanticKeywordSort
} from "../components/semantic-view-types.ts";

const baseView = (
  name: string,
  sort: SemanticKeywordSort,
  scope: SemanticSavedView["scope"] = "PROJECT_SHARED"
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

test("keeps a different project-shared sort for root and every semantic folder", () => {
  const firstGroupId = crypto.randomUUID();
  const secondGroupId = crypto.randomUUID();
  const views = [
    baseView(semanticFolderSortViewName(), "TEXT_ASC"),
    baseView(semanticFolderSortViewName(firstGroupId), "PRIORITY_DESC"),
    baseView(semanticFolderSortViewName(secondGroupId), "SOURCE_ASC"),
    baseView(
      semanticFolderSortViewName(firstGroupId),
      "UPDATED_ASC",
      "PRIVATE"
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
});
