import assert from "node:assert/strict";
import test from "node:test";
import { buildSiteStructure } from "./site-structure.ts";
import { pageMapLayout } from "./page-map-layout.ts";

test("page map includes every expanded URL and sorts branches by their page count", () => {
  const urls = Array.from({ length: 180 }, (_, index) => `https://example.com/ai/page-${index}/`);
  urls.push("https://example.com/articles/one/", "https://example.com/articles/two/");
  const structure = buildSiteStructure(urls);
  const layout = pageMapLayout(structure.nodes, "example.com", structure.total, new Map(), {});
  assert.equal(layout.nodes.length, 185);
  assert.equal(layout.nodes[1]?.node.path, "/ai/");
  assert.equal(new Set(layout.nodes.map((item) => item.node.path)).size, layout.nodes.length);
  assert.ok(layout.nodes.every((item) => item.y >= 0 && item.x >= 0));
  const siblings = layout.nodes.filter((item) => item.parent === "/ai/");
  assert.ok(new Set(siblings.map((item) => item.x)).size > 1, "large sibling lists occupy multiple columns");
  const rowCounts = new Map<number, number>();
  for (const node of siblings) rowCounts.set(node.y, (rowCounts.get(node.y) ?? 0) + 1);
  assert.ok([...rowCounts.values()].every((count) => count <= 6));
  assert.ok(layout.height < 6000, "180 pages remain a compact grid rather than a vertical strip");
  const collapsed = pageMapLayout(structure.nodes, "example.com", structure.total, new Map(), { "/ai/": false });
  assert.equal(collapsed.nodes.length, 5);
  assert.equal(collapsed.nodes.find((item) => item.node.path === "/ai/")?.node.count, 180);
});
