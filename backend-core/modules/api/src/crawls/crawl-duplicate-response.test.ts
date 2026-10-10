import assert from "node:assert/strict";
import test from "node:test";
import { crawlDuplicateGroupCollection } from "./crawl-duplicate-response.js";

const group = {
  id: "01900000-0000-7000-8000-000000000001",
  crawlId: "01900000-0000-7000-8000-000000000002",
  kind: "TITLE",
  memberCount: 2,
  members: [
    {
      pageId: "01900000-0000-7000-8000-000000000003",
      url: "https://example.com/a"
    },
    {
      pageId: "01900000-0000-7000-8000-000000000004",
      url: "https://example.com/b"
    }
  ],
  createdAt: "2026-08-01T10:00:00.000Z"
};

test("accepts exact complete crawl duplicate groups", () => {
  assert.deepEqual(crawlDuplicateGroupCollection({ groups: [group] }), {
    groups: [group]
  });
});

test("rejects truncated, extensible and duplicate member groups", () => {
  for (const candidate of [
    { ...group, memberCount: 3 },
    { ...group, signatureHash: "a".repeat(64) },
    { ...group, kind: "BODY" },
    { ...group, members: [group.members[0], group.members[0]] }
  ]) {
    assert.throws(
      () => crawlDuplicateGroupCollection({ groups: [candidate] }),
      /invalid crawl duplicate response/u
    );
  }
});

test("accepts the complete 5000-page producer result for every duplicate kind", () => {
  const members = Array.from({ length: 5000 }, (_, index) => ({ pageId: `01900000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`, url: `https://example.com/${index}` }));
  const groups = ["CONTENT", "TITLE", "DESCRIPTION", "H1"].map((kind, index) => ({ ...group, id: `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`, kind, members, memberCount: 5000 }));
  assert.deepEqual(crawlDuplicateGroupCollection({ groups }), { groups });
  assert.throws(() => crawlDuplicateGroupCollection({ groups: [...groups, { ...groups[0], id: "01900000-0000-7000-8000-000000000099" }] }), /invalid crawl duplicate response/u);
});
