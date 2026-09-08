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
  await importWorkbook(firstProject.id, initialWorkbook, `initial-google-${nonce}.xlsx`);
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
      { date: "2026-09-06", measured: 1, positioned: 1 },
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
      searchEngines: ["GOOGLE"]
    }
  })).data;
  const completedExport = await waitFor(`projects/${firstProject.id}/exports/${exportJob.id}`, value => value.status === "COMPLETED", ["FAILED_FINAL", "CANCELLED"]);
  assert.equal(completedExport.rowCount, 2);
  const download = await api.get(`/app/api/projects/${firstProject.id}/exports/${exportJob.id}/file`);
  assert.equal(download.status(), 200);
  const exportedWorkbook = await download.body();
  await writeFile(path.join(output, "round-trip-position-history.xlsx"), exportedWorkbook, { mode: 0o600 });
  await importWorkbook(secondProject.id, exportedWorkbook, `round-trip-google-${nonce}.xlsx`);

  const secondKeywords = await keywordRows(secondProject.id);
  const secondCatalog = (await call("GET", `projects/${secondProject.id}/keyword-ranks/dimensions`)).data;
  const secondMobile = secondCatalog.dimensions.find(item => item.searchEngine === "GOOGLE" && item.regionCode === "1011969" && item.device === "MOBILE");
  const secondDesktop = secondCatalog.dimensions.find(item => item.searchEngine === "GOOGLE" && item.regionCode === "1011973" && item.device === "DESKTOP");
  assert.ok(secondMobile && secondDesktop);
  const secondComparison = (await call("POST", `projects/${secondProject.id}/keyword-ranks/comparison`, {
    keywordIds: secondKeywords.map(item => item.id),
    dimensionKeys: [secondMobile.key, secondDesktop.key]
  })).data;
  assert.deepEqual(projectComparison(secondComparison, secondKeywords.find(item => item.language === "ru").id, secondMobile.key), { found: false, position: undefined, previousPosition: 7, provider: "MANUAL_IMPORT" });
  assert.deepEqual(projectComparison(secondComparison, secondKeywords.find(item => item.language === "en").id, secondDesktop.key), { found: true, position: 3, previousPosition: undefined, provider: "MANUAL_IMPORT" });

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

  await page.getByRole("button", { name: "Колонки и представления", exact: true }).click();
  const layout = page.locator("aside.semantic-layout-drawer");
  const positionColumn = layout.locator(".semantic-layout-column-row").filter({ hasText: "Google · Москва · Телефон · Позиция" });
  await positionColumn.waitFor();
  await positionColumn.locator('input[type="checkbox"]').check();
  const comparisonLoaded = page.waitForResponse(response =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith(`/projects/${firstProject.id}/keyword-ranks/comparison`)
  );
  await layout.getByRole("button", { name: "Применить", exact: true }).click();
  await comparisonLoaded;
  const dynamicHeader = page.locator('th:has(.semantic-rank-column-header[title="Google · Москва · Телефон · Позиция"])');
  await dynamicHeader.waitFor({ state: "attached" });
  await layout.getByRole("button", { name: "Закрыть настройки таблицы" }).click();
  await page.locator(".semantic-table-wrap").evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await dynamicHeader.waitFor();
  const dynamicColumnIndex = await dynamicHeader.evaluate(element => element.cellIndex);
  const russianRankCell = page.locator(`tr[data-presence-key="keyword:${russian.id}"] td`).nth(dynamicColumnIndex);
  await russianRankCell.getByText("×", { exact: true }).waitFor();
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
  await regional.getByText("Позиции по городам", { exact: true }).waitFor();
  await regional.locator(".custom-select-trigger").click();
  const mobileMoscowOption = page.locator(".custom-select-option").filter({ hasText: "Google · Москва · Телефон" });
  await mobileMoscowOption.locator(".search-engine-logo.google").waitFor();
  await mobileMoscowOption.locator(".semantic-rank-device-badge svg").waitFor();
  await mobileMoscowOption.click();
  await regional.locator(".custom-select-trigger .search-engine-logo.google").waitFor();
  await regional.locator(".custom-select-trigger .semantic-rank-device-badge svg").waitFor();
  const declinedDelta = regional.locator(".semantic-regional-rank-row .semantic-rank-comparison-position .declined");
  await declinedDelta.waitFor();
  assert.ok(
    Number.parseFloat(await declinedDelta.evaluate(element => getComputedStyle(element).fontSize)) >= 14,
    "regional position delta is too small"
  );
  await regional.getByRole("button", { name: "История", exact: true }).click();
  const historyDialog = page.locator("dialog[open].semantic-modal");
  await historyDialog.getByText("URL не сохранён", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "manual-history-sidebar.png") });
  await historyDialog.locator(".semantic-modal-close").click();

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

  assert.deepEqual(browserErrors, []);
  assert.deepEqual(paidRequests, []);

  async function keywordRows(projectId) {
    const result = await call("GET", `projects/${projectId}/keywords?limit=100&sort=CREATED_ASC`);
    return result.data.filter(item => keywordInput.some(input => input.text === item.textOriginal));
  }

  async function importWorkbook(projectId, bytes, fileName) {
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
    const keywordLanguage = parsed.preview.columns.find(column => column.sourceName === "Язык запроса");
    assert.ok(phrase && keywordLanguage);
    await call("POST", `projects/${projectId}/imports/${semanticImport.id}/mapping`, {
      columns: [
        { sourceIndex: phrase.index, target: "keyword.text" },
        { sourceIndex: keywordLanguage.index, target: "keyword.language" }
      ],
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: false,
      positionHistory: {
        searchEngine: "GOOGLE",
        countryCode: "RU",
        regionCode: "1011969",
        regionLabel: "Москва",
        language: "ru",
        device: "MOBILE"
      }
    }, { version: parsed.version });
    const validated = await waitFor(`projects/${projectId}/imports/${semanticImport.id}`, value => value.status === "AWAITING_CONFIRMATION", ["FAILED", "CANCELLED"]);
    assert.equal(validated.validation.uniqueKeywordsToProcess, "2");
    await call("POST", `projects/${projectId}/imports/${semanticImport.id}/publish`, undefined, { version: validated.version });
    const completed = await waitFor(`projects/${projectId}/imports/${semanticImport.id}`, value => value.status === "COMPLETED", ["FAILED", "CANCELLED"]);
    assert.equal(completed.result.createdMetricSnapshots, "4");
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

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
