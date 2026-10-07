import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { chromium, request } from "playwright";
import { semanticPositionHistoryExportFile } from "../../backend-execution/dist/semantic-exports/semantic-export-encoder.js";

test("real Yandex and Google history imports share one date row in the keyword inspector", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
  timeout: 180_000
}, async (t) => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL;
  const fixturePath = process.env.SEO_PLATFORM_SESSION_FIXTURES;
  assert.ok(base?.startsWith("https://"));
  assert.ok(fixturePath);
  const [fixture] = JSON.parse(await readFile(fixturePath, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: fixture.storageState });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await api.dispose(); });

  async function call(method, endpoint, data, version) {
    const csrf = (await api.storageState()).cookies.find(({ name }) => name === "seo_csrf")?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, {
      method,
      headers: {
        Origin: base,
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}),
        ...(version === undefined ? {} : { "If-Match": `"v${version}"` })
      },
      ...(data === undefined ? {} : { data })
    });
    const body = await response.json();
    assert.ok(response.ok(), `${method} ${endpoint}: ${response.status()} ${body.error?.code ?? ""}`);
    return body.data;
  }
  async function until(endpoint, status) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await call("GET", endpoint);
      if (value.status === status) return value;
      assert.ok(!["FAILED", "REJECTED", "ABORTED", "CANCELLED"].includes(value.status), `${endpoint}: ${value.status}`);
      await delay(500);
    }
    assert.fail(`${endpoint} did not reach ${status}`);
  }

  const nonce = randomUUID().slice(0, 8);
  const workspace = await call("POST", "workspaces", { name: `Pair ranks ${nonce}`, country: "RU", locale: "ru", timezone: "Europe/Berlin", billingCurrency: "RUB" });
  await call("POST", `workspaces/${workspace.id}/billing/trial`);
  const project = await call("POST", `workspaces/${workspace.id}/projects`, { name: `Pair ranks ${nonce}`, domain: `pair-${nonce}.example.invalid`, locale: "ru", timezone: "Europe/Berlin" });
  const phrase = `позиции по датам ${nonce}`;
  await call("POST", `projects/${project.id}/keywords/bulk`, { items: [{ text: phrase, language: "ru", priority: 0, isFavorite: false, isTracked: true }], duplicatePolicy: "SKIP_EXISTING" });
  const keywords = await call("GET", `projects/${project.id}/keywords?limit=100&sort=CREATED_ASC`);
  const keyword = keywords.find(({ textOriginal }) => textOriginal === phrase);
  assert.ok(keyword);

  async function importEngine(searchEngine, regionCode, positions) {
    const history = (async function* () {
      yield {
        keywordId: keyword.id,
        text: keyword.textOriginal,
        keywordLanguage: "ru",
        createdAt: keyword.createdAt,
        dimension: {
          key: `${searchEngine}|RU|${regionCode}|ru|DESKTOP`,
          searchEngine, countryCode: "RU", regionCode, regionLabel: "Москва", language: "ru", device: "DESKTOP"
        },
        snapshots: positions.map(({ date, position }) => ({ searchEngine, observedDate: date, found: true, position }))
      };
    })();
    const dates = positions.map(({ date }) => date);
    const file = semanticPositionHistoryExportFile(history, {
      format: "XLSX", scope: "SELECTED", locale: "ru", columns: ["query"], keywordIds: [keyword.id],
      positionHistory: { observedFrom: "2026-10-01T00:00:00.000Z", observedBefore: "2026-10-08T00:00:00.000Z", searchEngines: [searchEngine] }
    }, { rowCount: 1, dates: { YANDEX: searchEngine === "YANDEX" ? dates : [], GOOGLE: searchEngine === "GOOGLE" ? dates : [] } }, new Date("2026-10-07T12:00:00.000Z"));
    const chunks = [];
    for await (const chunk of file.bytes) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const declared = await call("POST", `projects/${project.id}/uploads`, { fileName: `${searchEngine.toLowerCase()}-${nonce}.xlsx`, mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: String(bytes.length) });
    const parts = await call("POST", `projects/${project.id}/uploads/${declared.upload.id}/parts`, { partNumbers: [1] });
    const uploaded = await api.put("/app/api/storage-upload", { headers: { Origin: base, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x-seo-storage-url": parts.parts[0].url }, data: bytes });
    assert.equal(uploaded.status(), 204);
    await call("POST", `projects/${project.id}/uploads/${declared.upload.id}/complete`, { parts: [{ partNumber: 1, etag: uploaded.headers().etag }] });
    await until(`projects/${project.id}/uploads/${declared.upload.id}`, "READY");
    const semanticImport = await call("POST", `projects/${project.id}/imports`, { uploadId: declared.upload.id });
    const parsed = await until(`projects/${project.id}/imports/${semanticImport.id}`, "AWAITING_MAPPING");
    const phraseColumn = parsed.preview.columns.find(({ sourceName }) => sourceName === "Фраза");
    assert.ok(phraseColumn);
    await call("POST", `projects/${project.id}/imports/${semanticImport.id}/mapping`, {
      columns: [{ sourceIndex: phraseColumn.index, target: "keyword.text" }],
      defaultLanguage: "ru", groupSeparator: "/", duplicatePolicy: "MERGE_NON_EMPTY", createMissingKeywords: false,
      positionHistory: { searchEngine, countryCode: "RU", regionCode, regionLabel: "Москва", language: "ru", device: "DESKTOP" }
    }, parsed.version);
    const validated = await until(`projects/${project.id}/imports/${semanticImport.id}`, "AWAITING_CONFIRMATION");
    await call("POST", `projects/${project.id}/imports/${semanticImport.id}/publish`, undefined, validated.version);
    const completed = await until(`projects/${project.id}/imports/${semanticImport.id}`, "COMPLETED");
    assert.equal(completed.result.createdMetricSnapshots, "2");
  }

  await importEngine("YANDEX", "213", [{ date: "2026-10-06", position: 4 }, { date: "2026-10-05", position: 10 }]);
  await importEngine("GOOGLE", "1011969", [{ date: "2026-10-06", position: 2 }, { date: "2026-10-05", position: 7 }]);

  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base }, { name: "seo_project", value: project.id, url: base }]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/app/semantics`);
  await page.locator(`tr[data-presence-key="keyword:${keyword.id}"]`).click();
  await page.locator("aside.semantic-keyword-inspector nav.semantic-inspector-tabs").getByRole("tab", { name: "Позиции" }).click();
  const rows = page.locator(".semantic-seo-rank-table tbody tr");
  await rows.first().waitFor();
  assert.equal(await rows.count(), 2);
  assert.deepEqual(await rows.evaluateAll((elements) => elements.map((row) => ({
    date: row.querySelector("time")?.getAttribute("datetime"),
    positions: [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim())
  }))), [
    { date: "2026-10-06", positions: ["4", "2"] },
    { date: "2026-10-05", positions: ["10", "7"] }
  ]);
  assert.deepEqual(pageErrors, []);
});
