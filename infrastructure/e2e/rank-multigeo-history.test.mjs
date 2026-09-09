import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { chromium, request } from "playwright";
import { semanticPositionHistoryExportFile } from "../../backend-execution/dist/semantic-exports/semantic-export-encoder.js";

test("multi-geo ranks, dated XLSX round trip, advanced filters and large group union", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
  timeout: 480_000
}, async t => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL;
  const output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
  assert.ok(base?.startsWith("https://"));
  assert.ok(output?.startsWith("/home/dev/.local/share/seo-platform-runtime/tmp/e2e."));
  const fixtures = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  assert.ok(fixtures.length >= 2);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const api = await request.newContext({ baseURL: base, storageState: fixtures[0].storageState });
  const outsider = await request.newContext({ baseURL: base, storageState: fixtures[1].storageState });
  const browser = await chromium.launch({ headless: true });
  const browserErrors = [];
  const paidRequests = [];
  const rankReadRequests = [];
  let page;
  t.after(async () => {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, "rank-multigeo-last.png"), fullPage: true });
      await writeFile(path.join(output, "rank-multigeo-last.html"), await page.content(), { mode: 0o600 });
    }
    await writeFile(path.join(output, "rank-multigeo-report.json"), JSON.stringify({ browserErrors, paidRequests }, null, 2), { mode: 0o600 });
    await browser.close();
    await api.dispose();
    await outsider.dispose();
  });

  async function call(method, endpoint, data, options = {}) {
    const client = options.client ?? api;
    const csrf = (await client.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await client.fetch(`/app/api/${endpoint}`, {
      method,
      headers: {
        Origin: base,
        ...(options.csrf === false || !csrf ? {} : { "X-CSRF-Token": csrf }),
        ...(["POST", "PATCH", "PUT", "DELETE"].includes(method) ? { "Idempotency-Key": randomUUID() } : {}),
        ...(options.version === undefined ? {} : { "If-Match": `"v${options.version}"` })
      },
      ...(data === undefined ? {} : { data })
    });
    const body = await response.json().catch(() => ({}));
    const expected = options.expected;
    if (expected) assert.ok(expected.includes(response.status()), `${method} ${endpoint}: ${response.status()} ${body.error?.code ?? ""}`);
    else assert.ok(response.ok(), `${method} ${endpoint}: ${response.status()} ${body.error?.code ?? ""}`);
    return { response, body, data: body.data };
  }

  const nonce = randomUUID().slice(0, 8);
  await call("PATCH", "me/preferences", { locale: "ru" });
  const workspace = (await call("POST", "workspaces", {
    name: `Rank history E2E ${nonce}`,
    country: "RU",
    locale: "ru",
    timezone: "Europe/Berlin",
    billingCurrency: "RUB"
  })).data;
  await call("POST", `workspaces/${workspace.id}/billing/trial`);
  const firstProject = (await call("POST", `workspaces/${workspace.id}/projects`, {
    name: `Rank source ${nonce}`,
    domain: `rank-${nonce}.example.invalid`,
    locale: "ru",
    timezone: "Europe/Berlin"
  })).data;
  const secondProject = (await call("POST", `workspaces/${workspace.id}/projects`, {
    name: `Rank round trip ${nonce}`,
    domain: `round-${nonce}.example.invalid`,
    locale: "ru",
    timezone: "Europe/Berlin"
  })).data;
  const largeNoteMarkdown = `# Большая заметка ${nonce}\n\n${"данные без ограничения\n".repeat(5_000)}`;
  assert.ok(largeNoteMarkdown.length > 100_000);
  const largeNote = (await call("POST", `projects/${firstProject.id}/notes`, {
    title: `Большая заметка ${nonce}`,
    markdown: largeNoteMarkdown,
    visibility: "PROJECT_MEMBERS"
  })).data;
  const reloadedLargeNote = (await call(
    "GET",
    `projects/${firstProject.id}/notes/${largeNote.id}`
  )).data;
  assert.equal(reloadedLargeNote.markdown, largeNoteMarkdown.trim());
  const keywordInput = [
    { text: `история позиции ${nonce}`, language: "ru", priority: 10, isFavorite: false, isTracked: true },
    { text: `position history ${nonce}`, language: "en", priority: 20, isFavorite: false, isTracked: true }
  ];
  for (const project of [firstProject, secondProject]) {
    const result = (await call("POST", `projects/${project.id}/keywords/bulk`, {
      items: keywordInput,
      duplicatePolicy: "SKIP_EXISTING"
    })).data;
    assert.equal(result.created, 2);
  }
  const groupNames = Array.from({ length: 101 }, (_, index) => `E2E multi ${nonce} ${String(index + 1).padStart(3, "0")}`);
  const groups = (await call("POST", `projects/${firstProject.id}/keyword-groups/bulk`, { names: groupNames })).data;
  assert.equal(groups.length, 101);

  const firstKeywords = await keywordRows(firstProject.id);
  const generated = semanticPositionHistoryExportFile(historyRows(firstKeywords), {
    format: "XLSX",
    scope: "SELECTED",
    locale: "ru",
    columns: ["query"],
    keywordIds: firstKeywords.map(item => item.id),
    positionHistory: {
      observedFrom: "2026-09-01T00:00:00.000Z",
      observedBefore: "2026-09-09T00:00:00.000Z",
      searchEngines: ["GOOGLE"]
    }
  }, {
    rowCount: 2,
    dates: { YANDEX: [], GOOGLE: ["2026-09-07", "2026-09-06", "2026-09-05"] }
  }, new Date("2026-09-08T10:00:00.000Z"));
  const initialWorkbook = await collect(generated.bytes);
  await writeFile(path.join(output, "initial-position-history.xlsx"), initialWorkbook, { mode: 0o600 });
  await importWorkbook(firstProject.id, initialWorkbook, `initial-google-mobile-${nonce}.xlsx`, {
    defaultLanguage: "ru",
    regionCode: "1011969",
    regionLabel: "Москва",
    language: "ru",
    device: "MOBILE"
  });
  await importWorkbook(firstProject.id, initialWorkbook, `initial-google-desktop-${nonce}.xlsx`, {
    defaultLanguage: "en",
    regionCode: "1011973",
    regionLabel: "Санкт-Петербург",
    language: "en",
    device: "DESKTOP"
  });
  await importWorkbook(firstProject.id, initialWorkbook, `initial-google-imported-${nonce}.xlsx`, {
    defaultLanguage: "en",
    regionCode: "global",
    regionLabel: "Импорт Key Collector",
    language: "en",
    device: "DESKTOP"
  });
  const rawMergeSettings = (await call(
    "GET",
    `projects/${firstProject.id}/rank-workbench/dimension-merges`
  )).data;
  const importedDesktop = rawMergeSettings.dimensions.find(item =>
    item.searchEngine === "GOOGLE" && item.regionCode === "global" && item.device === "DESKTOP"
  );
  const regularDesktop = rawMergeSettings.dimensions.find(item =>
    item.searchEngine === "GOOGLE" && item.regionCode === "1011973" && item.device === "DESKTOP"
  );
  assert.ok(importedDesktop && regularDesktop);
  const dimensionMerge = (await call(
    "POST",
    `projects/${firstProject.id}/rank-workbench/dimension-merges`,
    {
      sourceDimensionKey: importedDesktop.key,
      targetDimensionKey: regularDesktop.key
    }
  )).data;
  assert.equal(dimensionMerge.source.regionLabel, "Импорт Key Collector");
  assert.equal(dimensionMerge.target.regionLabel, "Санкт-Петербург");
  const dailyHistory = (await call(
    "GET",
    `projects/${firstProject.id}/keywords/position-history?includeUntracked=true`
  )).data;
  assert.deepEqual(
    dailyHistory.points.map(point => point.date),
    ["2026-09-05", "2026-09-06", "2026-09-07"]
  );
  assert.equal(new Set(dailyHistory.points.map(point => point.date)).size, 3);
  assert.deepEqual(
    dailyHistory.points.map(point => ({
      date: point.date,
      measured: point.measuredKeywordCount,
      positioned: point.positionedKeywordCount
    })),
    [
      { date: "2026-09-05", measured: 1, positioned: 0 },
      { date: "2026-09-06", measured: 2, positioned: 1 },
      { date: "2026-09-07", measured: 2, positioned: 1 }
    ]
  );

  const catalog = (await call("GET", `projects/${firstProject.id}/keyword-ranks/dimensions`)).data;
  const mobile = catalog.dimensions.find(item => item.searchEngine === "GOOGLE" && item.regionCode === "1011969" && item.device === "MOBILE");
  const desktop = catalog.dimensions.find(item => item.searchEngine === "GOOGLE" && item.regionCode === "1011973" && item.device === "DESKTOP");
  assert.ok(mobile && desktop);
  const comparison = (await call("POST", `projects/${firstProject.id}/keyword-ranks/comparison`, {
    keywordIds: firstKeywords.map(item => item.id),
    dimensionKeys: [mobile.key, desktop.key]
  })).data;
  const russian = firstKeywords.find(item => item.language === "ru");
  const english = firstKeywords.find(item => item.language === "en");
  assert.deepEqual(projectComparison(comparison, russian.id, mobile.key), { found: false, position: undefined, previousPosition: 7, provider: "MANUAL_IMPORT" });
  assert.deepEqual(projectComparison(comparison, english.id, desktop.key), { found: true, position: 3, previousPosition: undefined, provider: "MANUAL_IMPORT" });
  const positionReport = (await call("POST", `projects/${firstProject.id}/rank-workbench/positions`, {
    dimensionKey: mobile.key,
    observedFrom: "2026-09-01T00:00:00.000Z",
    observedBefore: "2026-09-09T00:00:00.000Z",
    dateLimit: 8,
    limit: 100,
    sort: "QUERY_ASC"
  })).data;
  assert.deepEqual(positionReport.dates, ["2026-09-07", "2026-09-06"]);
  assert.equal(positionReport.summary.keywordCount, 2);
  assert.equal(positionReport.summary.measuredCount, 1);
  assert.deepEqual(
    positionReport.rows.find(row => row.keywordId === russian.id).cells.map(cell => ({ date: cell.date, found: cell.found, position: cell.position })),
    [
      { date: "2026-09-07", found: false, position: undefined },
      { date: "2026-09-06", found: true, position: 7 }
    ]
  );
  const serpReport = (await call("POST", `projects/${firstProject.id}/rank-workbench/serp`, {
    dimensionKeys: [mobile.key, desktop.key],
    limit: 50
  })).data;
  assert.equal(serpReport.rows.length, 2);
  assert.ok(serpReport.rows.every(row => row.snapshots.length === 0));
  const filtered = (await call("GET", `projects/${firstProject.id}/keywords?limit=100&rankDimensionKey=${encodeURIComponent(mobile.key)}&rankState=NOT_FOUND`)).data;
  assert.deepEqual(filtered.map(item => item.id), [russian.id]);
  await call("POST", `projects/${firstProject.id}/keyword-ranks/comparison`, {
    keywordIds: [russian.id],
    dimensionKeys: [mobile.key]
  }, { client: outsider, expected: [403, 404] });
  await call("POST", `projects/${firstProject.id}/keyword-ranks/comparison`, {
    keywordIds: [russian.id],
    dimensionKeys: [mobile.key]
  }, { csrf: false, expected: [403] });

  const largeUnion = await call("POST", `projects/${firstProject.id}/keywords/list`, {
    query: { limit: 100, sort: "CREATED_DESC", groupIds: groups.map(item => item.id) }
  });
  assert.equal(largeUnion.data.length, 0);

  const exportJob = (await call("POST", `projects/${firstProject.id}/exports`, {
    format: "XLSX",
    scope: "SELECTED",
    locale: "ru",
    columns: ["query"],
    keywordIds: firstKeywords.map(item => item.id),
    sort: "CREATED_ASC",
    positionHistory: {
      observedFrom: "2026-09-01T00:00:00.000Z",
      observedBefore: "2026-09-09T00:00:00.000Z",
      searchEngines: ["GOOGLE"],
      dimensionKeys: [mobile.key]
    }
  })).data;
  const completedExport = await waitFor(`projects/${firstProject.id}/exports/${exportJob.id}`, value => value.status === "COMPLETED", ["FAILED_FINAL", "CANCELLED"]);
  assert.equal(completedExport.rowCount, 2);
  const download = await api.get(`/app/api/projects/${firstProject.id}/exports/${exportJob.id}/file`);
  assert.equal(download.status(), 200);
  const exportedWorkbook = await download.body();
  await writeFile(path.join(output, "round-trip-position-history.xlsx"), exportedWorkbook, { mode: 0o600 });
  await importWorkbook(secondProject.id, exportedWorkbook, `round-trip-google-${nonce}.xlsx`, {
    defaultLanguage: "ru",
    regionCode: "1011969",
    regionLabel: "Москва",
    language: "ru",
    device: "MOBILE"
  });

  const secondKeywords = await keywordRows(secondProject.id);
  const secondCatalog = (await call("GET", `projects/${secondProject.id}/keyword-ranks/dimensions`)).data;
  const secondMobile = secondCatalog.dimensions.find(item => item.searchEngine === "GOOGLE" && item.regionCode === "1011969" && item.device === "MOBILE");
  const secondDesktop = secondCatalog.dimensions.find(item => item.searchEngine === "GOOGLE" && item.regionCode === "1011973" && item.device === "DESKTOP");
  assert.ok(secondMobile);
  assert.equal(secondDesktop, undefined);
  const secondComparison = (await call("POST", `projects/${secondProject.id}/keyword-ranks/comparison`, {
    keywordIds: secondKeywords.map(item => item.id),
    dimensionKeys: [secondMobile.key]
  })).data;
  assert.deepEqual(projectComparison(secondComparison, secondKeywords.find(item => item.language === "ru").id, secondMobile.key), { found: false, position: undefined, previousPosition: 7, provider: "MANUAL_IMPORT" });

  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    { name: "seo_workspace", value: workspace.id, url: base, secure: true, sameSite: "Lax" },
    { name: "seo_project", value: firstProject.id, url: base, secure: true, sameSite: "Lax" },
    { name: "seo_ui_locale", value: "ru", url: base, secure: true, sameSite: "Lax" }
  ]);
  page = await context.newPage();
  page.on("pageerror", error => browserErrors.push(error.message.slice(0, 300)));
  page.on("request", requestValue => {
    const pathname = new URL(requestValue.url()).pathname;
    if (requestValue.method() === "POST" && /\/(rank-runs|checkout)$/u.test(pathname)) paidRequests.push(pathname);
    if (/\/keyword-ranks\/(dimensions|comparison)$/u.test(pathname)) rankReadRequests.push(`${requestValue.method()} ${pathname}`);
  });
  await page.goto(
    `${base}/app/projects/${firstProject.id}/rankings/contexts`,
    { waitUntil: "networkidle" }
  );
  const mergePanel = page.locator(".tracking-dimension-merges");
  await mergePanel.locator(".tracking-dimension-merge-list").waitFor();
  await mergePanel.getByText("Импорт Key Collector", { exact: true }).waitFor();
  await mergePanel.getByText("Санкт-Петербург", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "rank-dimension-merge-settings.png"), fullPage: true });
  await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });

  await page.locator('[data-presence-key="semantic-action:positions"]').click();
  await page.getByRole("menuitem", { name: "Собрать позиции", exact: true }).click();
  const rankDialog = page.locator("dialog[open].semantic-modal");
  await rankDialog.locator(".semantic-rank-targets").waitFor();
  await rankDialog.locator(".semantic-rank-target-devices label").filter({ hasText: "Телефон" }).click();
  const addCity = rankDialog.locator(".semantic-rank-target-add");
  await addCity.locator(".custom-select-trigger").click();
  await page.locator(".custom-select-option").filter({ hasText: "Санкт-Петербург — 2" }).click();
  const saintPetersburgTarget = rankDialog.locator(".semantic-rank-target").filter({ hasText: "Санкт-Петербург" });
  await saintPetersburgTarget.locator(".semantic-rank-target-devices label").filter({ hasText: "Телефон" }).click();
  await rankDialog.getByText("Отдельных съёмов: 4. Результаты сохранятся по каждому городу и устройству.", { exact: true }).waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await rankDialog.locator(".semantic-rank-targets").scrollIntoViewIfNeeded();
    const bounds = await rankDialog.boundingBox();
    assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `rank dialog exceeds ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflows ${width}px`);
    await page.screenshot({ path: path.join(output, `rank-targets-${width}.png`) });
  }
  await rankDialog.locator(".semantic-modal-close").click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.locator('[data-presence-key="semantic-action:competitors"]').click();
  await page.getByRole("menuitem", { name: "Собрать ИИ-выдачу", exact: true }).click();
  const aiSerpDialog = page.locator("dialog[open].semantic-modal");
  await aiSerpDialog.locator(".semantic-rank-targets").waitFor();
  await aiSerpDialog.locator(".semantic-rank-target-devices label").filter({ hasText: "Телефон" }).click();
  assert.equal(await aiSerpDialog.locator('.semantic-rank-target-devices input[type="checkbox"]:checked').count(), 2);
  await page.screenshot({ path: path.join(output, "ai-serp-targets.png"), fullPage: true });
  await aiSerpDialog.locator(".semantic-modal-close").click();

  await page.getByRole("button", { name: "Колонки и представления", exact: true }).click();
  const layout = page.locator("aside.semantic-layout-drawer");
  const positionColumn = layout.locator(".semantic-layout-column-row").filter({ hasText: "Google · Москва · Телефон · Позиция" });
  const desktopPositionColumn = layout.locator(".semantic-layout-column-row").filter({ hasText: "Google · Санкт-Петербург · ПК · en · Позиция" });
  const urlColumn = layout.locator(".semantic-layout-column-row").filter({ hasText: "Google · Москва · Телефон · Найденный URL" });
  const checkedAtColumn = layout.locator(".semantic-layout-column-row").filter({ hasText: "Google · Москва · Телефон · Дата съёма" });
  await positionColumn.waitFor();
  for (const column of [positionColumn, desktopPositionColumn, urlColumn, checkedAtColumn]) {
    await column.locator('input[type="checkbox"]').check();
  }
  const comparisonLoaded = page.waitForResponse(response =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith(`/projects/${firstProject.id}/keyword-ranks/comparison`)
  );
  await layout.getByRole("button", { name: "Применить", exact: true }).click();
  await comparisonLoaded;
  const dynamicHeader = page.locator('th:has(.semantic-rank-column-header[title="Google · Москва · Телефон · Позиция"])');
  const desktopDynamicHeader = page.locator('th:has(.semantic-rank-column-header[title="Google · Санкт-Петербург · ПК · en · Позиция"])');
  const dynamicUrlHeader = page.locator('th:has(.semantic-rank-column-header[title="Google · Москва · Телефон · Найденный URL"])');
  const dynamicCheckedAtHeader = page.locator('th:has(.semantic-rank-column-header[title="Google · Москва · Телефон · Дата съёма"])');
  await dynamicHeader.waitFor({ state: "attached" });
  await desktopDynamicHeader.waitFor({ state: "attached" });
  await dynamicUrlHeader.waitFor({ state: "attached" });
  await dynamicCheckedAtHeader.waitFor({ state: "attached" });
  await layout.getByRole("button", { name: "Закрыть настройки таблицы" }).click();
  await page.locator(".semantic-table-wrap").evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await dynamicHeader.waitFor();
  const dynamicColumnIndex = await dynamicHeader.evaluate(element => element.cellIndex);
  const russianRankCell = page.locator(`tr[data-presence-key="keyword:${russian.id}"] td`).nth(dynamicColumnIndex);
  await russianRankCell.getByText("×", { exact: true }).waitFor();
  const desktopDynamicColumnIndex = await desktopDynamicHeader.evaluate(element => element.cellIndex);
  const standardPositionCell = page.locator(`tr[data-presence-key="keyword:${english.id}"] td.semantic-column-googlePosition`);
  const desktopDynamicPositionCell = page.locator(`tr[data-presence-key="keyword:${english.id}"] td`).nth(desktopDynamicColumnIndex);
  await standardPositionCell.locator(".semantic-position-value").waitFor();
  await desktopDynamicPositionCell.locator(".semantic-position-value").waitFor();
  assert.equal(
    await standardPositionCell.locator(".semantic-position-value > strong").evaluate(element => getComputedStyle(element).fontWeight),
    await desktopDynamicPositionCell.locator(".semantic-position-value > strong").evaluate(element => getComputedStyle(element).fontWeight),
    "standard and geographic position values must share the same weight"
  );
  const positionSortRequest = page.waitForRequest(requestValue => {
    const url = new URL(requestValue.url());
    return requestValue.method() === "GET" &&
      url.pathname.endsWith(`/projects/${firstProject.id}/keywords`) &&
      url.searchParams.get("sort") === "RANK_POSITION_ASC" &&
      url.searchParams.get("rankSortDimensionKey") === mobile.key;
  });
  await dynamicHeader.getByRole("button").click();
  await positionSortRequest;
  await dynamicHeader.waitFor();
  assert.equal(await dynamicHeader.getAttribute("aria-sort"), "ascending");
  const checkedAtSortRequest = page.waitForRequest(requestValue => {
    const url = new URL(requestValue.url());
    return requestValue.method() === "GET" &&
      url.pathname.endsWith(`/projects/${firstProject.id}/keywords`) &&
      url.searchParams.get("sort") === "RANK_CHECKED_AT_DESC" &&
      url.searchParams.get("rankSortDimensionKey") === mobile.key;
  });
  await dynamicCheckedAtHeader.getByRole("button").click();
  await checkedAtSortRequest;
  await dynamicCheckedAtHeader.waitFor();
  assert.equal(await dynamicCheckedAtHeader.getAttribute("aria-sort"), "descending");
  assert.equal(await dynamicUrlHeader.getAttribute("aria-sort"), null);
  await page.waitForTimeout(350);
  const tableBeforeLayout = await tablePresentation(page, dynamicHeader, russianRankCell);
  const rankReadCountBeforeLayout = rankReadRequests.length;
  await page.getByRole("button", { name: "Колонки и представления", exact: true }).click();
  await layout.waitFor();
  await page.waitForTimeout(350);
  const tableWithLayout = await tablePresentation(page, dynamicHeader, russianRankCell);
  assert.deepEqual(tableWithLayout, tableBeforeLayout, "opening the layout drawer shifted or cleared the rank table");
  assert.equal(rankReadRequests.length, rankReadCountBeforeLayout, "opening the layout drawer reloaded rank data");
  await page.screenshot({ path: path.join(output, "layout-drawer-stable-table.png") });
  await layout.getByRole("button", { name: "Закрыть настройки таблицы" }).click();
  await page.locator(`tr[data-presence-key="keyword:${russian.id}"]`).click();
  const regional = page.locator(".semantic-regional-ranks");
  await regional.locator(".semantic-inspector-section-heading h3").filter({ hasText: "Позиции по городам" }).waitFor();
  await regional.locator(".semantic-regional-rank-count").getByText("1", { exact: true }).waitFor();
  await page.locator(".semantic-normal-rank-chart svg[role='group']").waitFor();
  assert.equal(await page.locator(".semantic-inspector-ai-ranks").count(), 0, "AI section must stay hidden before the first saved AI snapshot");
  await regional.locator(".custom-select-trigger").click();
  const mobileMoscowOption = page.locator(".custom-select-option").filter({ hasText: "Москва" }).filter({ hasText: "Телефон" });
  await mobileMoscowOption.locator(".search-engine-logo.google").waitFor();
  await mobileMoscowOption.locator(".semantic-rank-device-badge svg").waitFor();
  await mobileMoscowOption.locator(".semantic-rank-dimension-position.missing").waitFor();
  const optionEngineBox = await mobileMoscowOption.locator(".semantic-rank-dimension-engine").boundingBox();
  assert.ok(optionEngineBox && optionEngineBox.width >= 34 && optionEngineBox.height <= 24, "search engine label collapsed inside the rank selector");
  const optionRegionBox = await mobileMoscowOption.locator(".semantic-rank-dimension-region").boundingBox();
  const optionDeviceBox = await mobileMoscowOption.locator(".semantic-rank-device-badge").boundingBox();
  assert.ok(optionRegionBox && optionDeviceBox && optionRegionBox.x < optionDeviceBox.x, "device must follow the city in the rank selector");
  const optionMeta = mobileMoscowOption.locator(".semantic-rank-dimension-meta");
  await optionMeta.waitFor();
  assert.match((await optionMeta.textContent()) ?? "", /2026.+MANUAL_IMPORT/u);
  const optionBox = await mobileMoscowOption.boundingBox();
  assert.ok(optionBox && optionBox.height <= 56, "rank selector option is too tall");
  await page.screenshot({ path: path.join(output, "regional-rank-selector-open.png") });
  const unavailableDesktopOption = page.locator(".custom-select-option").filter({ hasText: "Санкт-Петербург" }).filter({ hasText: "ПК" });
  assert.equal(await unavailableDesktopOption.isDisabled(), true);
  await mobileMoscowOption.click();
  await regional.locator(".custom-select-trigger .search-engine-logo.google").waitFor();
  await regional.locator(".custom-select-trigger .semantic-rank-device-badge svg").waitFor();
  const declinedDelta = regional.locator(".custom-select-trigger .semantic-rank-dimension-position.missing > small");
  await declinedDelta.waitFor();
  assert.ok(await declinedDelta.evaluate(element => element.classList.contains("declined")));
  const regionalDeltaFontSize = Number.parseFloat(
    await declinedDelta.evaluate(element => getComputedStyle(element).fontSize)
  );
  assert.ok(
    regionalDeltaFontSize >= 8 && regionalDeltaFontSize <= 10,
    "regional position delta must stay readable without overpowering the position"
  );
  const regionalTriggerBox = await regional.locator(".custom-select-trigger").boundingBox();
  assert.ok(regionalTriggerBox && regionalTriggerBox.height <= 52, "rank selector trigger is too tall");
  const chartBox = await page.locator(".semantic-normal-rank-chart").boundingBox();
  assert.ok(
    regionalTriggerBox &&
      chartBox &&
      regionalTriggerBox.y + regionalTriggerBox.height + 8 <= chartBox.y,
    "rank chart must not touch the regional selector"
  );
  const serpHistoryBox = await page.locator(".semantic-inspector-ranks > .semantic-serp-history-button").boundingBox();
  const competitorsBox = await page.locator(".semantic-inspector-ranks > .semantic-competitor-snapshot").first().boundingBox();
  assert.ok(competitorsBox && serpHistoryBox && competitorsBox.y + competitorsBox.height <= serpHistoryBox.y, "SERP history action is not below competitors");
  const inspector = page.locator("aside.semantic-keyword-inspector");
  const inspectorResizer = page.locator(".semantic-keyword-inspector-resizer");
  const beforeResize = await inspector.boundingBox();
  const chartBeforeResize = await page.locator(".semantic-normal-rank-chart svg[role='group']").boundingBox();
  const resizeHandle = await inspectorResizer.boundingBox();
  assert.ok(beforeResize && resizeHandle);
  assert.ok(Math.abs(resizeHandle.x - beforeResize.x) <= 7, "keyword inspector resize handle is not attached to the inspector edge");
  await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y + 160);
  await page.mouse.down();
  await page.mouse.move(resizeHandle.x - 90, resizeHandle.y + 160, { steps: 5 });
  await page.mouse.up();
  const afterResize = await inspector.boundingBox();
  const chartAfterResize = await page.locator(".semantic-normal-rank-chart svg[role='group']").boundingBox();
  assert.ok(afterResize && afterResize.width >= beforeResize.width + 70, "keyword inspector did not resize");
  assert.ok(chartBeforeResize && chartAfterResize && chartAfterResize.width >= chartBeforeResize.width + 70, "rank chart did not follow the inspector width");
  const personalizedRankPreferences = await page.evaluate(({ projectId, dimensionKey }) => ({
    dimension: Object.entries(localStorage).find(([key, value]) =>
      key.startsWith("seonorita:semantic-rank-dimension:v1:") &&
      key.includes(`:${projectId}:`) &&
      value === dimensionKey
    ),
    layout: Object.entries(localStorage).find(([key]) =>
      key.startsWith("seonorita:semantic-layout:v2:") && key.endsWith(`:${projectId}`)
    )
  }), { projectId: firstProject.id, dimensionKey: mobile.key });
  assert.ok(personalizedRankPreferences.dimension, "selected rank dimension was not saved for the current user and view");
  assert.ok(personalizedRankPreferences.layout, "inspector width was not saved in a user-scoped layout key");
  const englishSemanticRow = page.locator(`tr[data-presence-key="keyword:${english.id}"]`);
  await englishSemanticRow.click();
  await regional.locator(".custom-select-trigger .semantic-rank-dimension-region").getByText("Санкт-Петербург", { exact: true }).waitFor();
  await regional.locator(".custom-select-trigger .semantic-rank-device-badge").getByText("ПК", { exact: true }).waitFor();
  assert.equal(await page.locator(".semantic-inspector-ai-ranks").count(), 0, "AI section must be absent when the keyword has never had an AI snapshot");
  const preferredDimensionAfterFallback = await page.evaluate(({ projectId }) =>
    Object.entries(localStorage).find(([key]) =>
      key.startsWith("seonorita:semantic-rank-dimension:v1:") && key.includes(`:${projectId}:`)
    )?.[1], { projectId: firstProject.id });
  assert.equal(preferredDimensionAfterFallback, mobile.key, "automatic sidebar fallback overwrote the user's preferred slice");
  await page.locator(`tr[data-presence-key="keyword:${russian.id}"]`).click();
  await regional.locator(".custom-select-trigger .semantic-rank-dimension-region").getByText("Москва", { exact: true }).waitFor();
  await regional.locator(".custom-select-trigger .semantic-rank-device-badge").getByText("Телефон", { exact: true }).waitFor();
  assert.equal(await page.locator(".semantic-inspector-ai-ranks").count(), 0, "opening another keyword without AI history must not restore the empty AI section");
  await inspectorResizer.dblclick();
  await page.route("**/rank-history?*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("mode") !== "SERP") {
      await route.continue();
      return;
    }
    const common = {
      trackingContextId: "01900000-0000-7000-8000-000000000081",
      contextName: "Google · Москва · Телефон",
      searchEngine: "GOOGLE",
      searchSource: "LIVE",
      dimensionKey: mobile.key,
      regionCode: mobile.regionCode,
      regionLabel: mobile.regionLabel,
      device: mobile.device,
      provider: "XMLSTOCK"
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            ...common,
            snapshotId: "01900000-0000-7000-8000-000000000082",
            observedAt: "2026-09-09T13:00:00.000Z",
            serpResults: [
              { position: 2, rankingUrl: "https://moving.example.test/new" , title: "Выросший сайт", snippet: "Текущий снимок" },
              { position: 8, rankingUrl: "https://falling.example.test/new", title: "Упавший сайт", snippet: "Текущий снимок" },
              { position: 4, rankingUrl: "https://new.example.test/", title: "Новый сайт", snippet: "Текущий снимок" }
            ]
          },
          {
            ...common,
            snapshotId: "01900000-0000-7000-8000-000000000083",
            observedAt: "2026-09-08T13:00:00.000Z",
            serpResults: [
              { position: 6, rankingUrl: "https://www.moving.example.test/old", title: "Выросший сайт раньше", snippet: "Прошлый снимок" },
              { position: 3, rankingUrl: "https://falling.example.test/old", title: "Упавший сайт раньше", snippet: "Прошлый снимок" }
            ]
          }
        ],
        page: { hasNext: false, totalApprox: 2 }
      })
    });
  });
  await page.getByRole("button", { name: "История выдачи и конкурентов", exact: true }).click();
  const serpHistoryDialog = page.locator("dialog[open].semantic-modal");
  const movementToggle = serpHistoryDialog.getByRole("checkbox", { name: "Показать движение" });
  await movementToggle.waitFor();
  assert.equal(await movementToggle.isDisabled(), false);
  await movementToggle.check();
  await serpHistoryDialog.locator(".semantic-position-value.improved > small").getByText("▲4", { exact: true }).waitFor();
  await serpHistoryDialog.locator(".semantic-position-value.declined > small").getByText("▼5", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "serp-history-movement.png"), fullPage: true });
  await serpHistoryDialog.locator(".semantic-modal-close").click();
  await page.getByRole("button", { name: "История выдачи и конкурентов", exact: true }).click();
  const persistedMovementToggle = page.locator("dialog[open].semantic-modal").getByRole("checkbox", { name: "Показать движение" });
  await persistedMovementToggle.waitFor();
  assert.equal(await persistedMovementToggle.isChecked(), true);
  await page.locator("dialog[open].semantic-modal .semantic-modal-close").click();
  await page.unroute("**/rank-history?*");
  await regional.getByRole("button", { name: "История", exact: true }).click();
  const historyDialog = page.locator("dialog[open].semantic-modal");
  await historyDialog.getByText("URL не сохранён", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "manual-history-sidebar.png") });
  await historyDialog.locator(".semantic-modal-close").click();

  await page.goto(`${base}/app/rankings`, { waitUntil: "networkidle" });
  const rankingFilters = page.locator(".rankings-filter-bar");
  await rankingFilters.waitFor();
  assert.equal(await rankingFilters.locator("select").count(), 0);
  assert.equal(await rankingFilters.locator('input[type="date"]').count(), 0);
  assert.ok(await rankingFilters.locator(".custom-select-trigger").count() >= 2);
  await rankingFilters.locator(".semantic-group-picker-trigger").waitFor();
  assert.equal(await rankingFilters.locator(".semantic-group-picker-trigger-count").count(), 0);
  await rankingFilters.locator(".rankings-filter-secondary > .rankings-date-columns").waitFor();
  assert.equal(await page.getByText("История позиций по дням", { exact: true }).count(), 0);
  assert.equal(await page.locator(".rankings-table-heading-actions").count(), 0);
  const rankingFilterRows = await rankingFilters.evaluate(element => {
    const primary = element.querySelector(".rankings-filter-primary")?.getBoundingClientRect();
    const secondary = element.querySelector(".rankings-filter-secondary")?.getBoundingClientRect();
    return { primaryY: primary?.y ?? 0, secondaryY: secondary?.y ?? 0 };
  });
  assert.ok(rankingFilterRows.secondaryY > rankingFilterRows.primaryY, "rankings controls must occupy two clear rows");
  assert.match(await rankingFilters.locator(".rankings-date-filter .dashboard-date-range-trigger").innerText(), /2026/u);
  assert.equal(await page.locator(".rankings-distribution").count(), 0);
  await rankingFilters.locator(".dashboard-date-range-trigger").click();
  await page.locator(".dashboard-date-range-popover").waitFor();
  await page.locator(".dashboard-date-range-close").click();
  const expectedRankingRow = page.locator(".rankings-matrix").getByText(russian.textOriginal, { exact: true });
  await expectedRankingRow.waitFor({ timeout: 5_000 }).catch(async () => {
    await page.reload({ waitUntil: "networkidle" });
  });
  await expectedRankingRow.waitFor();
  await page.locator(".rankings-cell.lost").first().waitFor();
  const importedPositionRow = page.locator(".rankings-matrix tbody tr").filter({ hasText: russian.textOriginal });
  await importedPositionRow.locator(".rankings-cell-value").first().waitFor();
  assert.equal(await importedPositionRow.locator(".rankings-cell-value[href]").count(), 0, "imported positions without URLs must render as plain values");
  const initialDateColumns = page.locator(".rankings-date-column-heading");
  const initialDateColumnCount = await initialDateColumns.count();
  assert.ok(initialDateColumnCount > 1);
  assert.match(await initialDateColumns.first().locator("time").innerText(), /2026/u);
  const hiddenDate = await initialDateColumns.first().locator("time").getAttribute("datetime");
  await initialDateColumns.first().locator('input[type="checkbox"]').click();
  assert.equal(await page.locator(".rankings-date-column-heading").count(), initialDateColumnCount - 1);
  const queryWidthBefore = await page.locator(".rankings-matrix thead th").first().evaluate(element => element.getBoundingClientRect().width);
  await page.locator(".rankings-query-resizer").press("ArrowRight");
  const queryWidthAfter = await page.locator(".rankings-matrix thead th").first().evaluate(element => element.getBoundingClientRect().width);
  assert.ok(queryWidthAfter >= queryWidthBefore + 14, "rankings query column keyboard resize did not apply");
  await page.waitForTimeout(150);
  const rankingsPreferences = await page.evaluate(({ userId, projectId }) =>
    JSON.parse(localStorage.getItem(`seonorita:rankings-view:v1:${userId}:${projectId}`) ?? "null"),
    { userId: fixtures[0].userId, projectId: firstProject.id }
  );
  assert.ok(hiddenDate && rankingsPreferences.hiddenDates.includes(hiddenDate));
  assert.equal(rankingsPreferences.queryColumnWidth, Math.round(queryWidthAfter));
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".rankings-date-column-heading").count(), initialDateColumnCount - 1);
  assert.equal(
    Math.round(await page.locator(".rankings-matrix thead th").first().evaluate(element => element.getBoundingClientRect().width)),
    Math.round(queryWidthAfter)
  );
  const mismatchedSnapshotId = "01900000-0000-7000-8000-000000000094";
  const mismatchedObservedAt = "2026-09-08T16:00:00.000Z";
  const mismatchedTargetUrl = `https://${firstProject.domain}/target`;
  const mismatchedRankingUrl = `https://${firstProject.domain}/another-page`;
  await page.route("**/rank-workbench/positions", async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.rows = payload.data.rows.map(row => row.keywordId === russian.id ? {
      ...row,
      targetUrl: mismatchedTargetUrl,
      cells: row.cells.map(cell => cell.date === hiddenDate ? cell : {
        ...cell,
        snapshotId: mismatchedSnapshotId,
        observedAt: mismatchedObservedAt,
        found: true,
        position: 4,
        rankingUrl: mismatchedRankingUrl,
        siteResultCount: 2
      })
    } : row);
    await route.fulfill({ response, json: payload });
  });
  await page.route("**/rank-history?*", async route => {
    const url = new URL(route.request().url());
    const fullSerp = url.searchParams.get("mode") === "SERP";
    assert.equal(url.searchParams.get("limit"), fullSerp ? "10" : "200");
    assert.equal(url.searchParams.get("dimensionKey"), mobile.key);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{
          snapshotId: mismatchedSnapshotId,
          keywordId: russian.id,
          trackingContextId: "01900000-0000-7000-8000-000000000095",
          contextName: "Google · Москва · Телефон",
          searchEngine: "GOOGLE",
          dimensionKey: mobile.key,
          regionCode: mobile.regionCode,
          regionLabel: mobile.regionLabel,
          device: mobile.device,
          provider: "XMLSTOCK",
          observedAt: mismatchedObservedAt,
          found: true,
          position: 4,
          rankingUrl: mismatchedRankingUrl,
          siteResults: [
            { position: 4, rankingUrl: mismatchedRankingUrl, title: "Нерелевантная страница", snippet: "Страница проекта" },
            { position: 9, rankingUrl: `https://${firstProject.domain}/another-result`, title: "Ещё одна страница", snippet: "Страница проекта" }
          ],
          serpResults: [
            { position: 1, rankingUrl: "https://competitor.example.test/page", title: "Конкурент", snippet: "Полная выдача" },
            { position: 4, rankingUrl: mismatchedRankingUrl, title: "Нерелевантная страница", snippet: "Страница проекта" }
          ]
        }],
        page: { hasNext: false, totalApprox: 1 }
      })
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  const mismatchedRankingRow = page.locator(".rankings-matrix tbody tr").filter({ hasText: russian.textOriginal });
  await mismatchedRankingRow.getByRole("button", { name: "Открыть историю выдачи", exact: true }).waitFor();
  assert.equal(await mismatchedRankingRow.locator(".rankings-cell-actions a").count(), 0, "ranking cells must not repeat site links");
  assert.equal(await mismatchedRankingRow.getByRole("button", { name: "Открыть выдачу конкурентов", exact: true }).count(), 0, "SERP history must not be repeated in every date cell");
  const rankingPositionLink = mismatchedRankingRow.locator(".rankings-cell-value[href]").first();
  assert.equal(await rankingPositionLink.getAttribute("href"), mismatchedRankingUrl);
  const mismatchButton = mismatchedRankingRow.getByRole("button", { name: "Нерелевантный URL", exact: true }).first();
  await mismatchButton.waitFor();
  assert.notEqual(await mismatchButton.evaluate(element => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
  assert.equal(await mismatchButton.locator("svg").count(), 1);
  const mismatchCell = mismatchButton.locator("xpath=ancestor::td[1]");
  const actionButtons = mismatchCell.locator(".rankings-cell-actions > button");
  assert.equal(await actionButtons.count(), 2);
  const [firstActionBox, secondActionBox, mismatchCellBox] = await Promise.all([
    actionButtons.nth(0).boundingBox(),
    actionButtons.nth(1).boundingBox(),
    mismatchCell.boundingBox()
  ]);
  assert.ok(firstActionBox && secondActionBox && mismatchCellBox);
  assert.ok(
    Math.abs(
      firstActionBox.x + firstActionBox.width / 2 -
      (secondActionBox.x + secondActionBox.width / 2)
    ) <= 1 && secondActionBox.y > firstActionBox.y,
    "ranking cell actions must be vertical"
  );
  assert.ok(firstActionBox.x > mismatchCellBox.x + mismatchCellBox.width / 2, "ranking cell actions must stay on the right");
  const positionValueBox = await mismatchCell.locator(".rankings-cell-value > strong").boundingBox();
  assert.ok(positionValueBox);
  assert.ok(
    Math.abs(
      positionValueBox.x + positionValueBox.width / 2 -
      (mismatchCellBox.x + mismatchCellBox.width / 2)
    ) <= 1,
    "ranking position must stay centered in the full cell"
  );
  const positionDeltaFontSize = Number.parseFloat(await mismatchCell.locator(".rankings-cell-value > small").evaluate(element => getComputedStyle(element).fontSize));
  assert.ok(positionDeltaFontSize >= 10, "ranking position change must be visually prominent");
  await assertVisibleCheckboxesSquare(page, "rankings");
  await page.screenshot({ path: path.join(output, "rankings-irrelevant-url-cell.png"), fullPage: true });
  await mismatchedRankingRow.getByRole("button", { name: "Показать несколько страниц сайта в выдаче", exact: true }).first().click();
  const sitePagesDialog = page.locator("dialog[open].semantic-modal");
  await sitePagesDialog.getByRole("heading", { name: `Страницы сайта в выдаче · ${russian.textOriginal}`, exact: true }).waitFor();
  assert.equal(await sitePagesDialog.locator(".semantic-project-serp-results > li").count(), 2);
  await sitePagesDialog.locator(".semantic-modal-close").click();
  await sitePagesDialog.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("heading", { name: `История позиций · ${russian.textOriginal}`, exact: true }).count(), 0, "direct site pages modal must close without revealing position history");
  await mismatchButton.click();
  const mismatchDialog = page.locator("dialog[open].semantic-modal");
  await mismatchDialog.getByRole("heading", { name: `Нерелевантный URL · ${russian.textOriginal}`, exact: true }).waitFor();
  assert.equal(await mismatchDialog.locator(".semantic-url-comparison-list").count(), 0);
  assert.equal(await mismatchDialog.locator(".semantic-project-serp-results > li").count(), 1);
  await mismatchDialog.locator(".semantic-project-serp-position").getByText("4", { exact: true }).waitFor();
  assert.equal(await mismatchDialog.getByText("Конкурент", { exact: true }).count(), 0);
  const urlDifferenceToggle = mismatchDialog.getByRole("checkbox", { name: "Показать различия", exact: true });
  const comparedUrl = mismatchDialog.locator(".semantic-project-serp-result > a .semantic-competitor-url").first();
  const comparedDomain = comparedUrl.locator(":scope > b");
  const [urlBoxBeforeDifferences, domainWeightBeforeDifferences] = await Promise.all([
    comparedUrl.boundingBox(),
    comparedDomain.evaluate(element => getComputedStyle(element).fontWeight)
  ]);
  assert.ok(Number.parseFloat(await urlDifferenceToggle.locator("xpath=..").evaluate(element => getComputedStyle(element).gap)) >= 4);
  await urlDifferenceToggle.check();
  assert.ok(await mismatchDialog.locator(".semantic-project-serp-results mark.different").count() > 0);
  const [urlBoxAfterDifferences, domainWeightAfterDifferences] = await Promise.all([
    comparedUrl.boundingBox(),
    comparedDomain.evaluate(element => getComputedStyle(element).fontWeight)
  ]);
  assert.ok(urlBoxBeforeDifferences && urlBoxAfterDifferences);
  assert.ok(Math.abs(urlBoxAfterDifferences.x - urlBoxBeforeDifferences.x) < 0.5, "URL shifted when difference highlighting was enabled");
  assert.ok(Math.abs(urlBoxAfterDifferences.width - urlBoxBeforeDifferences.width) < 0.5, "URL width changed when difference highlighting was enabled");
  assert.equal(domainWeightAfterDifferences, domainWeightBeforeDifferences, "URL domain lost its bold weight when differences were shown");
  await page.screenshot({ path: path.join(output, "rankings-irrelevant-url.png"), fullPage: true });
  await mismatchDialog.locator(".semantic-modal-close").click();
  await page.unroute("**/rank-workbench/positions");
  await page.unroute("**/rank-history?*");
  await page.route("**/rank-workbench/positions", async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const seed = payload.data?.rows?.[0];
    if (seed) {
      payload.data.rows = Array.from({ length: 40 }, (_, index) => ({
        ...seed,
        keywordId: `01900000-0000-7000-8000-${String(index + 500).padStart(12, "0")}`,
        query: `${seed.query} ${index + 1}`
      }));
      payload.data.page = { hasNext: false, totalApprox: 40 };
    }
    await route.fulfill({ response, json: payload });
  });
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".rankings-matrix tbody tr").nth(20).waitFor();
  const tableScrollState = await page.locator(".rankings-table-scroll").evaluate(element => {
    const before = element.scrollTop;
    element.scrollTop = 500;
    return {
      before,
      after: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY
    };
  });
  assert.equal(tableScrollState.overflowY, "auto");
  assert.ok(tableScrollState.scrollHeight > tableScrollState.clientHeight, "rankings table must expose rows below its viewport");
  assert.ok(tableScrollState.after > tableScrollState.before, "rankings table did not scroll to lower keyword rows");
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, "rankings-workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "Распределение по ТОПам", exact: true }).click();
  await page.locator(".rankings-distribution").waitFor();
  await page.screenshot({ path: path.join(output, "rankings-distribution.png"), fullPage: true });
  await page.getByRole("button", { name: "Скрыть распределение", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".rankings-table-panel").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "rankings workspace overflows at 390px");
  await page.screenshot({ path: path.join(output, "rankings-workspace-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.unroute("**/rank-workbench/positions");

  await page.goto(`${base}/app/projects/${firstProject.id}/tools/serp`, { waitUntil: "networkidle" });
  await page.locator(".serp-controls").waitFor();
  assert.equal(await page.getByText("Выдача из поиска", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Результаты по запросам", { exact: true }).count(), 0);
  await page.locator(".serp-group-control .semantic-group-picker-trigger").waitFor();
  const serpLayout = await page.locator("main.content-tools").evaluate(element => {
    const style = getComputedStyle(element);
    const workbench = element.querySelector(".serp-workbench");
    return {
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      contentWidth: element.getBoundingClientRect().width,
      workbenchWidth: workbench?.getBoundingClientRect().width ?? 0,
      workbenchPaddingLeft: workbench ? Number.parseFloat(getComputedStyle(workbench).paddingLeft) : 0,
      workbenchPaddingRight: workbench ? Number.parseFloat(getComputedStyle(workbench).paddingRight) : 0
    };
  });
  assert.equal(serpLayout.paddingLeft, 0);
  assert.equal(serpLayout.paddingRight, 0);
  assert.ok(Math.abs(serpLayout.contentWidth - serpLayout.workbenchWidth) <= 20);
  assert.equal(serpLayout.workbenchPaddingLeft, 12);
  assert.equal(serpLayout.workbenchPaddingRight, 12);
  await page.locator(".serp-grid").waitFor();
  await page.getByText("Нет снимка", { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(output, "serp-workbench-empty.png"), fullPage: true });
  let serpPageRequests = 0;
  await page.route("**/rank-workbench/serp", async route => {
    serpPageRequests += 1;
    const requestBody = route.request().postDataJSON();
    const nextPage = requestBody?.cursor === "e2e-next";
    const requestedKeys = new Set(requestBody?.dimensionKeys ?? []);
    const requestedDimensions = [mobile, desktop].filter(({ key }) => requestedKeys.has(key));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: {
        dimensions: requestedDimensions,
        rows: nextPage ? [{
          keywordId: english.id,
          version: english.version,
          query: english.textOriginal,
          language: english.language,
          tags: [],
          snapshots: [],
          aiSnapshots: []
        }] : [{
          keywordId: russian.id,
          version: russian.version,
          query: russian.textOriginal,
          language: russian.language,
          tags: ["E2E"],
          targetUrl: `https://${firstProject.domain}/target`,
          snapshots: [
            {
              dimensionKey: mobile.key,
              snapshotId: "01900000-0000-7000-8000-000000000091",
              observedAt: "2026-09-08T14:00:00.000Z",
              provider: "XMLSTOCK",
              results: [
                { position: 1, url: "https://shared.example.test/first", title: "Общий конкурент", snippet: "Одинаковый домен в двух городах" },
                { position: 2, url: `https://${firstProject.domain}/target`, title: "Страница проекта", snippet: "Свой домен" },
                ...Array.from({ length: 10 }, (_, index) => ({
                  position: index + 3,
                  url: `https://mobile-${index}.example.test/page`,
                  title: `Мобильный результат ${index + 3}`,
                  snippet: "Дополнительный результат для проверки топ-10"
                }))
              ]
            },
            {
              dimensionKey: desktop.key,
              snapshotId: "01900000-0000-7000-8000-000000000092",
              observedAt: "2026-09-08T14:05:00.000Z",
              provider: "ARSENKIN",
              results: [
                { position: 1, url: "https://shared.example.test/second", title: "Общий конкурент", snippet: "Повторяющийся домен" },
                { position: 2, url: "https://watched.example.test/page", title: "Наблюдаемый конкурент", snippet: "Пользовательская подсветка" },
                ...Array.from({ length: 10 }, (_, index) => ({
                  position: index + 3,
                  url: `https://desktop-${index}.example.test/page`,
                  title: `Десктопный результат ${index + 3}`,
                  snippet: "Дополнительный результат для проверки топ-10"
                }))
              ]
            }
          ].filter(({ dimensionKey }) => requestedKeys.has(dimensionKey)),
          aiSnapshots: [{
            dimensionKey: mobile.key,
            snapshotId: "01900000-0000-7000-8000-000000000093",
            observedAt: "2026-09-08T14:10:00.000Z",
            provider: "ARSENKIN",
            results: [{
              position: 1,
              url: "https://ai-source.example.test/page",
              title: "Источник ИИ",
              snippet: "ИИ-выдача того же города и устройства"
            }]
          }].filter(({ dimensionKey }) => requestedKeys.has(dimensionKey))
        }],
        page: nextPage
          ? { hasNext: false, totalApprox: 2 }
          : { hasNext: true, nextCursor: "e2e-next", totalApprox: 2 }
      } })
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".serp-snapshot-cell").first().waitFor();
  await page.locator(".serp-grid.is-multi").waitFor();
  assert.ok(await page.locator(".serp-grid > thead th").first().evaluate(element => element.getBoundingClientRect().height) <= 42);
  await assertVisibleCheckboxesSquare(page, "SERP workbench");
  const aiSerpToggle = page.getByRole("checkbox", { name: "ИИ-выдача", exact: true });
  assert.equal(await aiSerpToggle.isChecked(), false);
  assert.ok(await page.getByText("Обычная выдача", { exact: true }).count() > 0);
  assert.equal(await page.getByText("Источник ИИ", { exact: true }).count(), 0, "ordinary SERP mode must hide AI sources");
  await aiSerpToggle.check();
  await page.getByText("Источник ИИ", { exact: true }).waitFor();
  assert.equal(await page.getByText("Общий конкурент", { exact: true }).count(), 0, "AI SERP mode must hide organic results");
  assert.ok(await page.getByText("ИИ-выдача", { exact: true }).count() > 0);
  await aiSerpToggle.uncheck();
  await page.getByText("Общий конкурент", { exact: true }).first().waitFor();
  const multiSerpLayout = await page.locator(".serp-grid-scroll").evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  assert.ok(multiSerpLayout.scrollWidth <= multiSerpLayout.clientWidth + 20, "two SERP slices should fit in one keyword row without meaningful horizontal clipping");
  const firstSerpCell = page.locator(".serp-snapshot-cell").first();
  assert.equal(await firstSerpCell.locator("ol > li").count(), 10);
  const serpRowExpand = page.locator(".serp-grid tbody tr").first().getByRole("button", { name: "Показать топ 12", exact: true });
  await serpRowExpand.click();
  assert.equal(await firstSerpCell.locator("ol > li").count(), 12);
  await page.locator(".serp-grid tbody tr").first().getByRole("button", { name: "Скрыть до топ-10", exact: true }).click();
  await page.getByText(english.textOriginal, { exact: true }).waitFor();
  assert.ok(serpPageRequests >= 2, "SERP infinite scroll did not request the next cursor page?" );
  await page.locator(".serp-snapshot-cell li.duplicate").first().waitFor();
  await page.locator(".serp-snapshot-cell li.own").waitFor();
  await page.locator(".serp-highlight-settings form input").fill("watched.example.test");
  await page.locator(".serp-highlight-settings form").getByRole("button").click();
  await page.locator(".serp-snapshot-cell li.watched").waitFor();
  await page.locator(".serp-highlight-settings form input").fill("shared.example.test");
  await page.locator(".serp-highlight-settings form").getByRole("button").click();
  const watchedChipColors = await page.locator(".serp-domain-chips button").evaluateAll(elements =>
    elements.map(element => getComputedStyle(element).getPropertyValue("--serp-domain-color").trim())
  );
  assert.equal(new Set(watchedChipColors).size, watchedChipColors.length, "each watched domain must receive its own highlight color");
  await page.locator(".serp-group-control .semantic-group-picker-trigger").click();
  const serpGroupPopover = page.locator(".semantic-group-picker-popover");
  await serpGroupPopover.locator('input[type="search"]').fill(groupNames[0]);
  const persistedSerpGroupRequest = page.waitForRequest(requestValue => {
    if (requestValue.method() !== "POST" || !new URL(requestValue.url()).pathname.endsWith(`/projects/${firstProject.id}/rank-workbench/serp`)) return false;
    return requestValue.postDataJSON()?.groupIds?.includes(groups[0].id) === true;
  });
  await serpGroupPopover.locator(".semantic-move-tree-choice").filter({ hasText: groupNames[0] }).click();
  await persistedSerpGroupRequest;
  await page.locator(".serp-group-control .semantic-group-picker-trigger").getByText(groupNames[0], { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "serp-workbench-populated.png"), fullPage: true });
  await page.locator(".serp-dimension-trigger").click();
  const checkedDimensions = page.locator(".serp-dimension-popover input:checked");
  assert.ok(await checkedDimensions.count() >= 2);
  await page.locator(".serp-dimension-popover label").filter({ hasText: desktop.regionLabel }).locator("input:checked").click();
  await page.locator(".serp-dimension-popover").getByRole("button", { name: "Готово", exact: true }).click();
  await page.locator(".serp-grid.is-single").waitFor();
  const singleSerpLayout = await page.locator(".serp-grid.is-single > tbody").evaluate(element => {
    const first = element.querySelector("tr");
    return {
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      containerWidth: element.getBoundingClientRect().width,
      firstWidth: first?.getBoundingClientRect().width ?? 0
    };
  });
  assert.equal(singleSerpLayout.columns, 3);
  assert.ok(singleSerpLayout.firstWidth <= singleSerpLayout.containerWidth / 3 + 2, "one SERP slice must keep each keyword within one third of the desktop grid");
  await page.screenshot({ path: path.join(output, "serp-workbench-single-slice.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await aiSerpToggle.check();
  await page.waitForFunction(({ projectId, groupId }) => {
    const entry = Object.entries(localStorage).find(([key]) =>
      key.startsWith("seonorita:serp-scope:v1:") && key.endsWith(`:${projectId}`)
    );
    if (!entry) return false;
    const saved = JSON.parse(entry[1]);
    return saved.groupId === groupId && saved.aiOnly === true && saved.dimensionKeys?.length === 1;
  }, { projectId: firstProject.id, groupId: groups[0].id });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".serp-snapshot-cell").first().waitFor();
  assert.equal(await page.getByRole("checkbox", { name: "ИИ-выдача", exact: true }).isChecked(), true);
  await page.locator(".serp-group-control .semantic-group-picker-trigger").getByText(groupNames[0], { exact: true }).waitFor();
  await page.locator(".serp-dimension-trigger").click();
  assert.equal(await page.locator(".serp-dimension-popover input:checked").count(), 1, "saved SERP slice was not restored");
  await page.locator(".serp-dimension-popover").getByRole("button", { name: "Готово", exact: true }).click();
  await page.getByText("Источник ИИ", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "SERP workbench overflows at 390px");
  await page.screenshot({ path: path.join(output, "serp-workbench-populated-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.unroute("**/rank-workbench/serp");

  await page.goto(`${base}/app`, { waitUntil: "networkidle" });
  await page.locator(".sidebar-usage-balance").getByText("Баланс", { exact: true }).waitFor();
  assert.equal(await page.getByText("Баланс данных", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Управлять тарифом и балансом", { exact: true }).count(), 0);
  const dashboardChart = page.locator(".dashboard-position-plot");
  await dashboardChart.locator(".dashboard-position-hit").first().waitFor();
  assert.equal(await dashboardChart.locator(".dashboard-position-tooltip").count(), 0, "dashboard chart tooltip must not open automatically");
  await dashboardChart.locator(".dashboard-position-hit").last().hover();
  await dashboardChart.locator(".dashboard-position-tooltip").waitFor();
  await page.mouse.move(0, 0);
  await dashboardChart.locator(".dashboard-position-tooltip").waitFor({ state: "detached" });
  const dashboardDimension = page.locator(".dashboard-rank-dimension-filter");
  await dashboardDimension.getByText("Поисковик, город и устройство", { exact: true }).waitFor();
  await dashboardDimension.locator(".custom-select-trigger").click();
  const dashboardMobileOption = page.locator(".custom-select-option").filter({
    has: page.locator(".semantic-rank-context-region", { hasText: "Москва" })
  }).filter({ has: page.locator(".semantic-rank-device-badge", { hasText: "Телефон" }) });
  await dashboardMobileOption.locator(".search-engine-logo.google").waitFor();
  await dashboardMobileOption.locator(".semantic-rank-device-badge svg").waitFor();
  const dimensionHistoryRequest = page.waitForRequest(requestValue => {
    const url = new URL(requestValue.url());
    return requestValue.method() === "GET" &&
      url.pathname.endsWith(`/projects/${firstProject.id}/keywords/position-history`) &&
      url.searchParams.get("rankDimensionKey") === mobile.key;
  });
  await dashboardMobileOption.click();
  await dimensionHistoryRequest;
  await dashboardDimension.locator(".custom-select-trigger .search-engine-logo.google").waitFor();
  await page.screenshot({ path: path.join(output, "dashboard-rank-dimension.png") });
  await page.setViewportSize({ width: 390, height: 900 });
  await dashboardDimension.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "dashboard rank selector overflows at 390px");
  await page.screenshot({ path: path.join(output, "dashboard-rank-dimension-390.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });

  await page.locator('[data-presence-key="semantic-action:export"]').click();
  const exportDialog = page.locator("dialog[open].semantic-modal");
  await exportDialog.locator(".semantic-export-grid .custom-select-trigger").first().click();
  await page.locator(".custom-select-option").filter({ hasText: "История позиций по датам" }).click();
  const engineInputs = exportDialog.locator(".semantic-history-export-engines input");
  await engineInputs.first().waitFor();
  assert.equal(await exportDialog.locator('.semantic-history-export-engines input[type="radio"]').count(), 0);
  assert.ok(await exportDialog.locator('.semantic-history-export-engines input[type="checkbox"]').count() >= 2);
  const exportDimension = exportDialog.locator(".semantic-history-export-dimensions .custom-select-trigger");
  await exportDimension.waitFor();
  await exportDimension.locator(".semantic-rank-context-region").getByText("Москва", { exact: true }).waitFor();
  await exportDimension.locator(".semantic-rank-device-badge").getByText("Телефон", { exact: true }).waitFor();
  await exportDialog.locator(".semantic-modal-close").click();

  await page.locator('[data-presence-key="semantic-action:wordstat"]').click();
  await page.getByRole("menuitem", { name: "Собрать сезонность", exact: true }).click();
  const seasonalityDialog = page.locator("dialog[open].semantic-modal");
  await seasonalityDialog.getByRole("heading", { name: "Сбор сезонности", exact: true }).waitFor();
  assert.equal(await seasonalityDialog.locator('.semantic-seasonality-range input[type="date"]').count(), 0);
  assert.equal(await seasonalityDialog.locator(".semantic-seasonality-range .custom-select-trigger").count(), 1);
  assert.equal(await seasonalityDialog.locator(".semantic-seasonality-range .dashboard-date-range-trigger").count(), 1);
  const seasonalityProviderCards = seasonalityDialog.locator(".semantic-provider-card");
  if (await seasonalityProviderCards.count() === 0) {
    await seasonalityDialog.getByText("Нет проверенного подключения с функцией Wordstat.", { exact: true }).waitFor();
  } else {
    await seasonalityProviderCards.first().waitFor();
    const xmlStockSeasonalityCard = seasonalityProviderCards.filter({ hasText: "XMLStock" });
    if (await xmlStockSeasonalityCard.count()) {
      await xmlStockSeasonalityCard.first().click();
      assert.equal(await seasonalityDialog.getByRole("checkbox", { name: "Фразовая" }).isDisabled(), false);
      assert.equal(await seasonalityDialog.getByRole("checkbox", { name: "Точная словоформа" }).isDisabled(), false);
    }
  }
  await seasonalityDialog.locator(".dashboard-date-range-trigger").click();
  await page.locator(".dashboard-date-range-popover").waitFor();
  await page.locator(".dashboard-date-range-close").click();
  await page.screenshot({ path: path.join(output, "seasonality-dialog.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "seasonality dialog overflows at 390px");
  await page.screenshot({ path: path.join(output, "seasonality-dialog-390.png"), fullPage: true });
  await seasonalityDialog.locator(".semantic-modal-close").click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  const largeKeywordNote = `Проверка большой заметки ${nonce}\n${"данные ключа\n".repeat(10_000)}`;
  assert.ok(largeKeywordNote.length > 100_000);
  const currentRussian = (await keywordRows(firstProject.id)).find(item => item.id === russian.id);
  assert.ok(currentRussian);
  const updatedRussian = (await call("PATCH", `projects/${firstProject.id}/keywords/${russian.id}`, {
    note: largeKeywordNote
  }, { version: currentRussian.version })).data;
  await page.reload({ waitUntil: "networkidle" });
  const russianRow = page.locator(`tr[data-presence-key="keyword:${russian.id}"]`);
  const noteLoaded = page.waitForResponse(response =>
    response.request().method() === "GET" &&
    new URL(response.url()).pathname.endsWith(`/projects/${firstProject.id}/keywords/${russian.id}/insights`)
  );
  await russianRow.locator(".semantic-keyword-note-indicator").click();
  await noteLoaded;
  const noteDialog = page.locator("dialog[open].semantic-modal");
  await noteDialog.locator("textarea").waitFor();
  await page.waitForFunction(
    ({ expected }) => document.querySelector("dialog[open].semantic-modal textarea")?.value.length === expected,
    { expected: largeKeywordNote.trim().length }
  );
  assert.equal((await noteDialog.locator("textarea").inputValue()).length, largeKeywordNote.trim().length);
  await page.screenshot({ path: path.join(output, "keyword-note-modal.png"), fullPage: true });
  await noteDialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await noteDialog.waitFor({ state: "detached" });
  assert.equal(updatedRussian.hasNote, true);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(`tr[data-presence-key="keyword:${russian.id}"] .semantic-keyword-note-indicator`).count(), 0);

  await page.route(`**/projects/${firstProject.id}/keywords?*`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data = payload.data.map(item => item.id === russian.id ? {
      ...item,
      targetUrl: `https://${firstProject.domain}/target`,
      hasMultipleRankingUrls: true,
      positions: [{
        searchEngine: "GOOGLE",
        dimension: mobile,
        found: true,
        position: 1,
        rankingUrl: `https://${firstProject.domain}/mobile-a`,
        siteResults: [
          { position: 1, rankingUrl: `https://${firstProject.domain}/mobile-a` },
          { position: 4, rankingUrl: `https://${firstProject.domain}/mobile-b` }
        ],
        observedAt: "2026-09-08T12:00:00.000Z"
      }, {
        searchEngine: "GOOGLE",
        dimension: regularDesktop,
        found: true,
        position: 2,
        rankingUrl: `https://${firstProject.domain}/target`,
        siteResults: [
          { position: 2, rankingUrl: `https://${firstProject.domain}/target` }
        ],
        observedAt: "2026-09-08T13:00:00.000Z"
      }]
    } : item);
    await route.fulfill({ response, json: payload });
  });
  await page.route("**/keyword-ranks/comparison", async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const body = route.request().postDataJSON();
    if (body.keywordIds?.length === 1 && body.keywordIds[0] === russian.id) {
      const seed = payload.data.find(item => item.keywordId === russian.id);
      if (seed) {
        payload.data = payload.data.filter(item =>
          item.keywordId !== russian.id ||
          ![mobile.key, regularDesktop.key].includes(item.dimensionKey)
        );
        if (body.dimensionKeys?.includes(mobile.key)) payload.data.push({
          ...seed,
          dimensionKey: mobile.key,
          found: true,
          position: 1,
          rankingUrl: `https://${firstProject.domain}/mobile-a`,
          siteResultCount: 2,
          observedAt: "2026-09-08T12:00:00.000Z"
        });
        if (body.dimensionKeys?.includes(regularDesktop.key)) payload.data.push({
          ...seed,
          dimensionKey: regularDesktop.key,
          found: true,
          position: 2,
          rankingUrl: `https://${firstProject.domain}/target`,
          siteResultCount: 1,
          observedAt: "2026-09-08T13:00:00.000Z"
        });
      }
    }
    await route.fulfill({ response, json: payload });
  });
  await page.route(`**/keywords/${russian.id}/insights?*`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const key = new URL(route.request().url()).searchParams.get("dimensionKey");
    const dimension = key === regularDesktop.key ? regularDesktop : mobile;
    payload.data.competitorSnapshots = [{
      dimensionKey: dimension.key,
      snapshotId: "01900000-0000-7000-8000-000000000099",
      trackingContextId: "01900000-0000-7000-8000-000000000098",
      contextName: "E2E URL context",
      searchEngine: "GOOGLE",
      provider: "XMLSTOCK",
      observedAt: key === regularDesktop.key ? "2026-09-08T13:00:00.000Z" : "2026-09-08T12:00:00.000Z",
      results: [1, 2].map((position) => ({
        position,
        url: `https://${firstProject.domain}/${key === regularDesktop.key ? "desktop" : "mobile"}-${position}`,
        title: `${dimension.regionLabel} ${position}`,
        snippet: "Контекстная выдача"
      }))
    }];
    await route.fulfill({ response, json: payload });
  });
  await page.reload({ waitUntil: "networkidle" });
  const urlRow = page.locator(`tr[data-presence-key="keyword:${russian.id}"]`);
  assert.equal(await urlRow.locator(".semantic-keyword-rank-indicator.mismatch").count(), 1);
  assert.equal(await urlRow.locator(".semantic-keyword-rank-indicator.multiple").count(), 1);
  await urlRow.getByRole("button", { name: "Показать несколько страниц сайта в выдаче", exact: true }).click();
  const multipleUrlDialog = page.locator("dialog[open].semantic-modal");
  await multipleUrlDialog.getByRole("heading", { name: `Целевой и найденные URL · ${russian.textOriginal}`, exact: true }).waitFor();
  await multipleUrlDialog.locator(".semantic-project-serp-results > li").first().waitFor();
  assert.equal(await multipleUrlDialog.locator(".semantic-project-serp-results > li").count(), 2);
  await multipleUrlDialog.locator(".semantic-modal-close").click();
  await urlRow.locator(".semantic-keyword-rank-indicator.mismatch").click();
  const urlDialog = page.locator("dialog[open].semantic-modal");
  await urlDialog.locator(".semantic-url-context-selector .custom-select-trigger").waitFor();
  assert.equal(await urlDialog.locator(".semantic-url-comparison-list").count(), 0);
  await urlDialog.locator(".semantic-project-serp-results a").filter({ hasText: `${firstProject.domain}/mobile-1` }).waitFor();
  await urlDialog.getByRole("checkbox", { name: "Показать различия", exact: true }).check();
  assert.ok(await urlDialog.locator(".semantic-project-serp-results mark.different").count() > 0);
  await urlDialog.locator(".semantic-url-context-selector .custom-select-trigger").click();
  const mismatchOptions = page.locator(".custom-select-popover .custom-select-option").filter({ has: page.locator(".semantic-rank-context") });
  assert.equal(await mismatchOptions.count(), 1, "target URL mismatch modal must omit dimensions whose URL matches the target");
  await mismatchOptions.filter({ hasText: "Москва" }).filter({ hasText: "Телефон" }).waitFor();
  assert.equal(await mismatchOptions.filter({ hasText: "Санкт-Петербург" }).count(), 0);
  await page.screenshot({ path: path.join(output, "url-context-selector.png"), fullPage: true });
  await urlDialog.locator(".semantic-modal-close").click();
  await page.unroute(`**/projects/${firstProject.id}/keywords?*`);
  await page.unroute("**/keyword-ranks/comparison");
  await page.unroute(`**/keywords/${russian.id}/insights?*`);
  await page.reload({ waitUntil: "networkidle" });

  let previewChunks = 0;
  let createChunks = 0;
  await page.route("**/keywords/bulk-preview", async route => {
    previewChunks += 1;
    const body = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: {
        selected: body.items.length,
        newKeywords: body.items.length,
        activeDuplicates: 0,
        trashedDuplicates: 0,
        restorableDeleted: 0,
        rows: body.items.map((item, index) => ({
          index, state: "NEW", groups: [], groupsTruncated: false, inTargetGroup: false
        }))
      } })
    });
  });
  await page.route("**/keywords/bulk", async route => {
    createChunks += 1;
    const body = route.request().postDataJSON();
    await delay(500);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: {
        selected: body.items.length,
        created: body.items.length,
        restored: 0, linked: 0, skipped: 0, rejected: 0, failed: 0,
        rows: body.items.map((_, index) => ({ index, outcome: "CREATED" }))
      } })
    });
  });
  await page.locator('[data-presence-key="semantic-action:add"]').click();
  const addDialog = page.locator("dialog[open].semantic-keyword-editor-modal");
  const pastedKeywords = Array.from({ length: 205 }, (_, index) => `E2E unlimited ${nonce} ${index}`).join("\n");
  const addTextarea = addDialog.locator("textarea");
  await addTextarea.fill(pastedKeywords);
  assert.equal(await addTextarea.getAttribute("maxlength"), null);
  assert.equal(await addDialog.getByText(/лимит за один запуск/u).count(), 0);
  await addDialog.getByRole("button", { name: "Проверить и добавить", exact: true }).click();
  await addDialog.waitFor({ state: "detached" });
  const addProgress = page.locator(".semantic-manual-add-toast");
  await addProgress.getByText("Добавление запросов", { exact: true }).waitFor();
  await addProgress.getByText(/Добавлено 100 · обработано 100 из 205/u).waitFor();
  await addProgress.getByText("Запросы добавлены", { exact: true }).waitFor();
  assert.equal(previewChunks, 3);
  assert.equal(createChunks, 3);
  await addProgress.getByRole("button", { name: "Закрыть уведомление" }).click();
  await page.unroute("**/keywords/bulk-preview");
  await page.unroute("**/keywords/bulk");

  const tree = page.locator("nav.semantic-group-tree");
  const firstRegularGroup = tree.locator(".semantic-group-tree-row:not(.system)").first();
  await firstRegularGroup.click();
  await page.keyboard.press("Control+a");
  await tree.locator("header").getByText("101", { exact: true }).waitFor();
  const bodyListRequest = page.waitForRequest(requestValue => requestValue.method() === "POST" && new URL(requestValue.url()).pathname.endsWith(`/projects/${firstProject.id}/keywords/list`));
  await tree.getByRole("button", { name: "Открыть выбранные группы вместе" }).click();
  const bodyRequest = await bodyListRequest;
  assert.equal(bodyRequest.postDataJSON().query.groupIds.length, 101);
  await page.getByText("Открыто групп: 101", { exact: true }).waitFor();

  await call("PATCH", "me/preferences", { locale: "en" });
  await context.addCookies([{ name: "seo_ui_locale", value: "en", url: base, secure: true, sameSite: "Lax" }]);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-presence-key="semantic-action:positions"]').click();
  await page.getByRole("menuitem", { name: "Collect rankings", exact: true }).click();
  const englishRankDialog = page.locator("dialog[open].semantic-modal");
  await englishRankDialog.getByText("Cities and devices", { exact: true }).waitFor();
  await englishRankDialog.getByText("For each city, choose desktop, mobile or both devices.", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "rank-targets-en.png") });
  await englishRankDialog.locator(".semantic-modal-close").click();

  const deletedDimension = (await call("POST", `projects/${firstProject.id}/rank-workbench/delete-dimension-history`, {
    dimensionKey: mobile.key,
    confirmation: "DELETE"
  })).data;
  assert.equal(deletedDimension.affectedSnapshots, 2);
  const afterDeletionCatalog = (await call("GET", `projects/${firstProject.id}/keyword-ranks/dimensions`)).data;
  assert.equal(afterDeletionCatalog.dimensions.some(item => item.key === mobile.key), false);
  const afterDeletionComparison = (await call("POST", `projects/${firstProject.id}/keyword-ranks/comparison`, {
    keywordIds: [russian.id],
    dimensionKeys: [mobile.key]
  })).data;
  assert.deepEqual(afterDeletionComparison, []);

  assert.deepEqual(browserErrors, []);
  assert.deepEqual(paidRequests, []);

  async function keywordRows(projectId) {
    const result = await call("GET", `projects/${projectId}/keywords?limit=100&sort=CREATED_ASC`);
    return result.data.filter(item => keywordInput.some(input => input.text === item.textOriginal));
  }

  async function importWorkbook(projectId, bytes, fileName, dimension) {
    const declared = (await call("POST", `projects/${projectId}/uploads`, {
      fileName,
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: String(bytes.byteLength)
    })).data;
    const parts = (await call("POST", `projects/${projectId}/uploads/${declared.upload.id}/parts`, { partNumbers: [1] })).data;
    const uploaded = await api.put("/app/api/storage-upload", {
      headers: {
        Origin: base,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-seo-storage-url": parts.parts[0].url
      },
      data: Buffer.from(bytes)
    });
    assert.equal(uploaded.status(), 204);
    const etag = uploaded.headers().etag;
    assert.ok(etag);
    await call("POST", `projects/${projectId}/uploads/${declared.upload.id}/complete`, { parts: [{ partNumber: 1, etag }] });
    await waitFor(`projects/${projectId}/uploads/${declared.upload.id}`, value => value.status === "READY", ["REJECTED", "ABORTED", "EXPIRED"]);
    const semanticImport = (await call("POST", `projects/${projectId}/imports`, { uploadId: declared.upload.id })).data;
    const parsed = await waitFor(`projects/${projectId}/imports/${semanticImport.id}`, value => value.status === "AWAITING_MAPPING", ["FAILED", "CANCELLED"]);
    const phrase = parsed.preview.columns.find(column => column.sourceName === "Фраза");
    assert.ok(phrase);
    await call("POST", `projects/${projectId}/imports/${semanticImport.id}/mapping`, {
      columns: [{ sourceIndex: phrase.index, target: "keyword.text" }],
      defaultLanguage: dimension.defaultLanguage,
      groupSeparator: "/",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: false,
      positionHistory: {
        searchEngine: "GOOGLE",
        countryCode: "RU",
        regionCode: dimension.regionCode,
        regionLabel: dimension.regionLabel,
        language: dimension.language,
        device: dimension.device
      }
    }, { version: parsed.version });
    const validated = await waitFor(`projects/${projectId}/imports/${semanticImport.id}`, value => value.status === "AWAITING_CONFIRMATION", ["FAILED", "CANCELLED"]);
    assert.equal(validated.validation.uniqueKeywordsToProcess, "1");
    await call("POST", `projects/${projectId}/imports/${semanticImport.id}/publish`, undefined, { version: validated.version });
    const completed = await waitFor(`projects/${projectId}/imports/${semanticImport.id}`, value => value.status === "COMPLETED", ["FAILED", "CANCELLED"]);
    assert.equal(completed.result.createdMetricSnapshots, "2");
  }

  async function waitFor(endpoint, complete, terminalFailures, attempts = 180) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = (await call("GET", endpoint)).data;
      if (complete(current)) return current;
      assert.ok(!terminalFailures.includes(current.status), `${endpoint} finished as ${current.status}: ${current.failureCode ?? ""}`);
      await delay(500);
    }
    assert.fail(`${endpoint} did not complete`);
  }
});

async function* historyRows(keywords) {
  const russian = keywords.find(item => item.language === "ru");
  const english = keywords.find(item => item.language === "en");
  assert.ok(russian && english);
  yield {
    keywordId: russian.id,
    text: russian.textOriginal,
    keywordLanguage: "ru",
    createdAt: russian.createdAt,
    dimension: {
      key: "GOOGLE|RU|1011969|ru|MOBILE",
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "1011969",
      regionLabel: "Москва",
      language: "ru",
      device: "MOBILE"
    },
    snapshots: [
      { searchEngine: "GOOGLE", observedDate: "2026-09-07", found: false },
      { searchEngine: "GOOGLE", observedDate: "2026-09-06", found: true, position: 7 }
    ]
  };
  yield {
    keywordId: english.id,
    text: english.textOriginal,
    keywordLanguage: "en",
    createdAt: english.createdAt,
    dimension: {
      key: "GOOGLE|RU|1011973|en|DESKTOP",
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "1011973",
      regionLabel: "Санкт-Петербург",
      language: "en",
      device: "DESKTOP"
    },
    snapshots: [
      { searchEngine: "GOOGLE", observedDate: "2026-09-07", found: true, position: 3 },
      { searchEngine: "GOOGLE", observedDate: "2026-09-05", found: false }
    ]
  };
}

function projectComparison(rows, keywordId, dimensionKey) {
  const item = rows.find(value => value.keywordId === keywordId && value.dimensionKey === dimensionKey);
  assert.ok(item);
  return {
    found: item.found,
    position: item.position,
    previousPosition: item.previousPosition,
    provider: item.provider
  };
}

async function tablePresentation(page, header, cell) {
  const table = page.locator(".semantic-table-wrap");
  const bounds = await table.boundingBox();
  assert.ok(bounds);
  return {
    header: (await header.innerText()).replace(/\s+/gu, " ").trim(),
    cell: (await cell.innerText()).replace(/\s+/gu, " ").trim(),
    scrollLeft: await table.evaluate(element => element.scrollLeft),
    x: Math.round(bounds.x),
    width: Math.round(bounds.width)
  };
}

async function assertVisibleCheckboxesSquare(page, surface) {
  const sizes = await page.locator('input[type="checkbox"]:visible').evaluateAll(elements =>
    elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    })
  );
  assert.ok(sizes.length > 0, `${surface} has no visible checkboxes to verify`);
  assert.deepEqual(
    sizes.filter(({ width, height }) => Math.abs(width - height) > 0.5),
    [],
    `${surface} contains a non-square checkbox`
  );
}

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
