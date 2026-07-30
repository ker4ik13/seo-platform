import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticKeywordListItem } from "@seo-platform/contracts";
import type { InternalProjectContext } from "../authorization/project-tenant.js";
import type { SeoDataClient } from "../seo-data/seo-data.client.js";
import { SemanticExportService } from "./semantic-export.service.js";

const context = {
  tenant: {
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    projectStatus: "ACTIVE"
  },
  actorId: "01900000-0000-7000-8000-000000000003",
  requestId: "request-1"
} as InternalProjectContext;

test("exports selected rows in the explicit selection order", async () => {
  const first = keyword("01900000-0000-7000-8000-000000000010", "first");
  const second = keyword("01900000-0000-7000-8000-000000000011", "second");
  const service = new SemanticExportService({
    listKeywords: async () => ({
      data: [first, second],
      page: { hasNext: false, totalApprox: 2 }
    }),
    listSemanticCustomColumns: async () => []
  } as unknown as SeoDataClient);

  const document = await service.create(context, {
    format: "NDJSON",
    scope: "SELECTED",
    locale: "en",
    columns: ["query"],
    keywordIds: [second.id, first.id]
  });
  const rows = Buffer.from(document.bytes)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row) as { query: string });
  assert.deepEqual(rows, [{ query: "second" }, { query: "first" }]);
});

function keyword(id: string, text: string): SemanticKeywordListItem {
  return {
    id,
    textOriginal: text,
    textNormalized: text,
    language: "en",
    priority: 0,
    isFavorite: false,
    isTracked: false,
    tags: [],
    tagsTruncated: false,
    sourceMode: "MANUAL",
    createdAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-30T09:00:00.000Z",
    version: 1
  };
}
