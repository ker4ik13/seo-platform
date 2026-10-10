import { chooseDateInput } from "./custom-date-controls.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { chromium, request } from "playwright";
import { positionImportCases, delimitedFile } from "./position-import-files.mjs";

test("real files: UI upload → ClamAV → import worker → persisted position history → public API/UI", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 900_000,
}, async t => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
  assert.equal(base, "https://144.31.221.28:3000");
  const [owner, , , foreign] = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: owner.storageState });
  const outsider = await request.newContext({ baseURL: base, storageState: foreign.storageState });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await api.dispose(); await outsider.dispose(); });
  async function command(path, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.post("/app/api/" + path, { headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() }, data });
    assert.ok(response.ok(), `Command ${path}: HTTP ${response.status()}`);
    return (await response.json()).data;
  }
  const workspace = await command("workspaces", { name: "Реальные импорты позиций", country: "RU", locale: "ru", timezone: "Europe/Moscow", billingCurrency: "RUB" });
  const domain = "import-" + randomUUID().slice(0, 8) + ".example.invalid";
  const project = await command(`workspaces/${workspace.id}/projects`, { name: "Файлы позиций", domain, locale: "ru", timezone: "Europe/Moscow" });
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base }, { name: "seo_project", value: project.id, url: base }]);
  const page = await context.newPage(), pageErrors = [], cases = positionImportCases(domain), report = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(base + "/app/semantics");
  await page.getByRole("button", { name: "Импорт", exact: true }).click();
  const upload = page.locator(".semantic-upload");
  await upload.locator(".semantic-import-source-option").filter({ has: page.locator("strong", { hasText: /^Позиции$/u }) }).click();
  assert.equal(await upload.getAttribute("data-source"), "POSITIONS");
  for (const fixture of cases) {
    let caseCompleted = false;
    await t.test(fixture.name, async () => {
      const started = performance.now();
      await writeFile(output + "/" + fixture.name, fixture.buffer, { mode: 0o600 });
      await upload.locator('input[type="file"]').setInputFiles({ name: fixture.name, mimeType: fixture.name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : fixture.name.endsWith(".tsv") ? "text/tab-separated-values" : "text/csv", buffer: fixture.buffer });
      const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/projects/${project.id}/imports`));
      await upload.getByRole("button", { name: "Начать загрузку", exact: true }).click();
      const creation = await created; assert.equal(creation.status(), 201);
      const imported = (await creation.json()).data;
      await upload.locator('.import-spreadsheet').waitFor({ timeout: 120_000 });
      assert.ok((await upload.getByRole("combobox", { name: "Расположение позиций", exact: true }).textContent()).includes(fixture.layout === "WIDE" ? "колонка" : "строка"));
      let expectedPositions = fixture.expected;
      if (fixture.name === "WIDE-CSV_BOM.csv") {
        // An intentional user edit, independently asserted in persisted history.
        await chooseDateInput(page, upload.getByRole("combobox", { name: "Дата колонки 06.10.2026", exact: true }), "2026-10-05");
        await upload.locator(".import-history-context").first().click();
        const settings = page.getByRole("dialog", { name: "Параметры снимка", exact: true });
        await settings.getByRole("combobox", { name: "Поисковая система", exact: true }).click();
        await page.getByRole("option").filter({ has: page.locator(".search-engine-logo.google") }).click();
        await settings.getByRole("combobox", { name: "Регион", exact: true }).click();
        await page.getByRole("option", { name: "Москва", exact: true }).click();
        await settings.getByRole("button", { name: "Применить", exact: true }).click();
        expectedPositions = fixture.expected.map(point => point[1] === "2026-10-06" ? [point[0], "2026-10-05", "GOOGLE", point[3], point[4], point[5]] : point);
        await upload.screenshot({ path: output + "/editable-mapping.png" });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: output + "/import-mapping-mobile.png" });
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      await upload.getByRole("checkbox", { name: "Добавлять отсутствующие запросы", exact: false }).check();
      if (fixture.expectedKeywordCount === 500) {
        const table = upload.locator(".import-preview-table");
        for (let i = 0; i < 6; i++) { await table.evaluate(element => { element.scrollTop = element.scrollHeight; }); await page.waitForTimeout(300); }
        assert.ok(await table.locator("tbody tr:not(.import-preview-spacer)").count() < 80, "preview DOM is bounded on a real 500-row file");
      }
      await upload.getByRole("button", { name: "Проверить импорт", exact: true }).click();
      await upload.locator('[aria-label="Проверка импорта"]').waitFor({ timeout: 120_000 });
      const summaryResponse = await api.get(`/app/api/projects/${project.id}/imports/${imported.id}`);
      const summary = (await summaryResponse.json()).data;
      assert.equal(summary.validation.errorRows, "0", JSON.stringify(summary.validation.issueCounts));
      const expectedCount = fixture.expectedKeywordCount ?? 3;
      assert.equal(summary.validation.uniqueKeywordsToProcess, String(expectedCount));
      await upload.getByRole("button", { name: new RegExp(`^Импортировать\\s+${expectedCount}$`, "u") }).click();
      await upload.locator('[aria-label="Результат импорта"]').waitFor({ timeout: 120_000 });
      const completed = (await (await api.get(`/app/api/projects/${project.id}/imports/${imported.id}`)).json()).data;
      assert.equal(completed.status, "COMPLETED");
      const safety = (await (await api.get(`/app/api/projects/${project.id}/uploads/${completed.uploadId}`)).json()).data;
      assert.equal(safety.status, "READY");
      const keywords = [];
      let cursor;
      do {
        const keywordResponse = await api.post(`/app/api/projects/${project.id}/keywords/list`, { headers: { Origin: base, "X-CSRF-Token": (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value }, data: { query: { search: fixture.name.split(".")[0].replaceAll("-", " "), limit: 100, ...(cursor ? { cursor } : {}) } } });
        assert.equal(keywordResponse.status(), 200);
        const body = await keywordResponse.json(); keywords.push(...body.data); cursor = body.page?.nextCursor;
      } while (cursor);
      const names = new Map(keywords.map(keyword => [keyword.id, keyword.textOriginal]));
      const rows = [];
      cursor = undefined;
      do {
        const history = await api.get(`/app/api/projects/${project.id}/rank-history?observedFrom=2026-10-01T00:00:00.000Z&observedBefore=2026-10-10T00:00:00.000Z&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        assert.equal(history.status(), 200);
        const body = await history.json(); rows.push(...body.data.filter(row => names.has(row.keywordId))); cursor = body.page?.nextCursor;
      } while (cursor);
      const actual = rows.map(row => [names.get(row.keywordId), row.observedAt.slice(0, 10), row.searchEngine, row.device, row.found ? row.position : null, row.rankingUrl ?? null]);
      const sorted = values => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      assert.deepEqual(sorted(actual), sorted(expectedPositions));
      assert.ok(!rows.some(row => names.get(row.keywordId) === fixture.missingKeyword), "empty measurements create no snapshots");
      assert.equal(keywords.find(keyword => keyword.textOriginal === fixture.targetKeyword)?.targetUrl, fixture.targetUrl, "target URL is separate from historical result URLs");
      assert.ok([403, 404].includes((await outsider.get(`/app/api/projects/${project.id}/imports/${imported.id}`)).status()));
      await upload.screenshot({ path: output + "/result-" + fixture.name + ".png" });
      report.push({ name: fixture.name, layout: fixture.layout, bytes: fixture.buffer.length, positions: actual.length, elapsedMs: Math.round(performance.now() - started) });
      caseCompleted = true;
    });
    if (!caseCompleted) throw new Error(`Real import failed: ${fixture.name}`);
  }
  await t.test("invalid dates are quarantined rather than converted to other months", async () => {
    const bytes = delimitedFile([["Запрос", "Дата", "Позиция"], ["ошибка даты", "31.02.2026", 8]]);
    await upload.locator('input[type="file"]').setInputFiles({ name: "invalid-date.csv", mimeType: "text/csv", buffer: bytes });
    await upload.getByRole("button", { name: "Начать загрузку", exact: true }).click();
    await upload.locator('.import-spreadsheet').waitFor({ timeout: 120_000 });
    await upload.getByRole("checkbox", { name: "Добавлять отсутствующие запросы", exact: false }).check();
    await upload.getByRole("button", { name: "Проверить импорт", exact: true }).click();
    await upload.locator('[aria-label="Проверка импорта"]').waitFor({ timeout: 120_000 });
    assert.ok((await upload.locator('[aria-label="Проверка импорта"]').textContent()).includes("дат"));
    assert.equal(await upload.getByRole("button", { name: /^Импортировать/u }).isEnabled(), false);
  });
  assert.deepEqual(pageErrors, []);
  await writeFile(output + "/position-import-results.json", JSON.stringify(report, null, 2), { mode: 0o600 });
});
