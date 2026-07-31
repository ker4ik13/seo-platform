import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  scopedProjectPage,
  scopedProjectPageCollection
} from "./page-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const pageId = "01900000-0000-7000-8000-000000000003";

const page = {
  id: pageId,
  workspaceId,
  projectId,
  url: "https://example.com/",
  normalizedUrl: "https://example.com/",
  aliases: [],
  sources: [
    {
      source: "MANUAL",
      firstSeenAt: "2026-07-30T10:00:00.000Z",
      lastSeenAt: "2026-07-30T10:00:00.000Z"
    }
  ],
  pageType: "EXISTING",
  indexability: "INDEXABLE",
  httpStatus: 200,
  priority: 10,
  analyticsMetrics: {},
  assignedKeywordCount: 3,
  assignedClusterCount: 2,
  lifecycleStatus: "ACTIVE",
  version: 1,
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z"
};

test("accepts exact tenant-scoped page responses", () => {
  assert.equal(
    scopedProjectPage(page, workspaceId, projectId, pageId).id,
    pageId
  );
  assert.deepEqual(
    scopedProjectPageCollection(
      { pages: [page], nextCursor: "cursor_page_1" },
      workspaceId,
      projectId
    ).pages,
    [page]
  );
});

test("rejects cross-tenant and response-shape drift", () => {
  assert.throws(
    () =>
      scopedProjectPage(
        { ...page, workspaceId: "01900000-0000-7000-8000-000000000009" },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      scopedProjectPage(
        { ...page, secret: "must-not-pass" },
        workspaceId,
        projectId
      ),
    DomainError
  );
});
