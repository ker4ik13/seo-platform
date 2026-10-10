import test from "node:test";
import assert from "node:assert/strict";
import { parseProjectPageStatisticsQuery, parseProjectPageStatisticsCollection, parseProjectPagePanelQuery, parseProjectPagePanel } from "./page-insights.js";
const id = "01900000-0000-7000-8000-000000000001";
const dimensionKey = "YANDEX|RU|213|ru|DESKTOP";

test("page statistics require bounded page IDs, a real date or the explicit latest mode", () => {
  assert.equal(parseProjectPageStatisticsQuery({ pageIds: id, dimensionKey, date: "latest" }).date, "latest");
  assert.throws(() => parseProjectPageStatisticsQuery({ pageIds: `${id},${id}`, dimensionKey, date: "2026-10-09" }));
  assert.throws(() => parseProjectPageStatisticsQuery({ pageIds: id, dimensionKey, date: "2026-02-30" }));
  assert.throws(() => parseProjectPageStatisticsQuery({ pageIds: Array(101).fill(id), dimensionKey, date: "2026-10-09" }));
});
test("statistics consumers distinguish missing measurements, missing ranks and a different URL", () => {
  const row = { pageId: id, assignedCount: 4, measuredCount: 3, matchedCount: 1, notFoundCount: 1, differentPageCount: 1, top10Count: 1, averagePosition: 4 };
  const value = { date: "2026-10-09", dimensionKey, pages: [row] };
  assert.equal(parseProjectPageStatisticsCollection(value).pages[0]?.averagePosition, 4);
  assert.throws(() => parseProjectPageStatisticsCollection({ ...value, pages: [{ ...row, matchedCount: 0 }] }));
  assert.throws(() => parseProjectPageStatisticsCollection({ ...value, pages: [{ ...row, averagePosition: 0 }] }));
  assert.throws(() => parseProjectPageStatisticsCollection({ ...value, date: "latest" }));
});
test("panel query and strict consumers agree on section and field boundaries", () => {
  assert.equal(parseProjectPagePanelQuery({ section: "SEMANTICS", limit: "50", dimensionKey, date: "latest" }).limit, 50);
  assert.throws(() => parseProjectPagePanelQuery({ section: "LINKS", dimensionKey, date: "2026-10-09" }));
  assert.deepEqual(parseProjectPagePanel({ pageId: id, section: "LINKS", links: [] }).links, []);
  assert.throws(() => parseProjectPagePanel({ pageId: id, section: "LINKS", links: [], keywords: [] }));
});
