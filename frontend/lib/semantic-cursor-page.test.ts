import assert from "node:assert/strict";
import test from "node:test";
import { semanticCursorPageIssue } from "./semantic-cursor-page.ts";

test("stops an infinite semantic cursor loop after a repeated page", () => {
  assert.equal(semanticCursorPageIssue({
    requestedCursor: "page-5",
    nextCursor: "page-5",
    hasNext: true,
    loadedIds: new Set(["keyword-1"]),
    returnedIds: ["keyword-1"],
    seenCursors: new Set(["page-1", "page-2", "page-3", "page-4"])
  }), "REPEATED_CURSOR");
  assert.equal(semanticCursorPageIssue({
    requestedCursor: "page-5",
    nextCursor: "page-6",
    hasNext: true,
    loadedIds: new Set(["keyword-1"]),
    returnedIds: ["keyword-1"],
    seenCursors: new Set(["page-1", "page-2", "page-3", "page-4"])
  }), "NO_PROGRESS");
  assert.equal(semanticCursorPageIssue({
    requestedCursor: "page-5",
    nextCursor: "page-6",
    hasNext: true,
    loadedIds: new Set(["keyword-1"]),
    returnedIds: ["keyword-2"],
    seenCursors: new Set(["page-1", "page-2", "page-3", "page-4"])
  }), undefined);
});
