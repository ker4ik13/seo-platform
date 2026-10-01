import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { chromium, request } from "playwright";
import { semanticPositionHistoryExportFile } from "../../backend-execution/dist/semantic-exports/semantic-export-encoder.js";
import { remoteWorkerFixture } from "./remote-worker-fixture.mjs";
import { parseAdminCancelOperationCommand } from "../../packages/contracts/dist/index.js";

test("HTTPS search, project switching, latest-slice ordering and persistent view controls", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 240000
}, async (t) => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL;
  assert.ok(base?.startsWith("https://"));
  const fixtures = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: fixtures[0].storageState });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const remote = process.env.SEO_PLATFORM_REMOTE_WORKER_SMOKE === "true" ? await remoteWorkerFixture(t) : undefined;
  try {
    const call = async (method, path, data, version) => {
      const csrf = (await api.storageState()).cookies.find(({ name }) => name === "seo_csrf")?.value;
      const response = await api.fetch(`/app/api/${path}`, { method, headers: {
        Origin: base, ...(csrf ? { "X-CSRF-Token": csrf } : {}), "Idempotency-Key": randomUUID(),
        ...(version ? { "If-Match": `"v${version}"` } : {})
      }, ...(data === undefined ? {} : { data }) });
      const payload = await response.json();
      assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${payload.error?.code ?? ""}`);
      return payload.data;
    };
    await call("PATCH", "me/preferences", { locale: "ru" });
    const name = `Поиск E2E ${randomUUID().slice(0, 8)}`;
    const area = await call("POST", "workspaces", { name, country: "RU", locale: "ru", timezone: "UTC", billingCurrency: "RUB" });
    await call("POST", `workspaces/${area.id}/billing/trial`);
    const project = await call("POST", `workspaces/${area.id}/projects`, { name: `${name} первый`, domain: "tochka-snab.ru", locale: "ru", timezone: "UTC" });
    const second = await call("POST", `workspaces/${area.id}/projects`, { name: `${name} второй`, domain: "nccenter.ru", locale: "ru", timezone: "UTC" });
    await call("POST", `projects/${project.id}/keywords/bulk`, { duplicatePolicy: "SKIP_EXISTING", items: [
      { text: "Свежий второй", language: "ru", priority: 10, isFavorite: false, isTracked: true },
      { text: "Свежий четвёртый", language: "ru", priority: 10, isFavorite: false, isTracked: true },
      { text: "Старый первый", language: "ru", priority: 10, isFavorite: false, isTracked: true },
      { text: "Неотслеживаемый восьмидесятый", language: "ru", priority: 10, isFavorite: false, isTracked: false }
    ] });
    const keywords = await call("GET", `projects/${project.id}/keywords?limit=100&sort=TEXT_ASC`);
    const generated = semanticPositionHistoryExportFile(historyRows(keywords), {
      format: "XLSX", scope: "SELECTED", locale: "ru", columns: ["query"], keywordIds: keywords.map(({ id }) => id),
      positionHistory: { observedFrom: "2026-09-01T00:00:00.000Z", observedBefore: "2026-10-01T00:00:00.000Z", searchEngines: ["GOOGLE"] }
    }, { rowCount: 4, dates: { YANDEX: [], GOOGLE: ["2026-09-29", "2026-09-28"] } }, new Date("2026-09-30T10:00:00.000Z"));
    const chunks = []; for await (const chunk of generated.bytes) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const upload = await call("POST", `projects/${project.id}/uploads`, { fileName: "rank-view.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: String(bytes.length) });
    const parts = await call("POST", `projects/${project.id}/uploads/${upload.upload.id}/parts`, { partNumbers: [1] });
    const sent = await api.put("/app/api/storage-upload", { headers: { Origin: base, "x-seo-storage-url": parts.parts[0].url, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, data: bytes });
    assert.equal(sent.status(), 204);
    await call("POST", `projects/${project.id}/uploads/${upload.upload.id}/complete`, { parts: [{ partNumber: 1, etag: sent.headers().etag }] });
    const waitFor = async (path, status) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const item = await call("GET", path);
        if (Array.isArray(status) ? status.includes(item.status) : item.status === status) return item;
        assert.ok(!["FAILED", "REJECTED", "CANCELLED"].includes(item.status), `${path}: ${item.status}`);
        await delay(500);
      }
      assert.fail(`Timeout: ${status}`);
    };
    await waitFor(`projects/${project.id}/uploads/${upload.upload.id}`, "READY");
    const imported = await call("POST", `projects/${project.id}/imports`, { uploadId: upload.upload.id });
    const importPath = `projects/${project.id}/imports/${imported.id}`;
    const parsed = await waitFor(importPath, "AWAITING_MAPPING");
    await call("POST", `${importPath}/mapping`, { columns: [{ sourceIndex: parsed.preview.columns.find(({ sourceName }) => sourceName === "Фраза").index, target: "keyword.text" }], defaultLanguage: "ru", groupSeparator: "/", duplicatePolicy: "MERGE_NON_EMPTY", createMissingKeywords: false, positionHistory: { searchEngine: "GOOGLE", countryCode: "RU", regionCode: "1011969", regionLabel: "Москва", language: "ru", device: "DESKTOP" } }, parsed.version);
    const validated = await waitFor(importPath, "AWAITING_CONFIRMATION");
    await call("POST", `${importPath}/publish`, undefined, validated.version);
    await waitFor(importPath, "COMPLETED");
    if (remote) {
      const exported = await call("POST", `projects/${project.id}/exports`, { format: "XLSX", scope: "FULL_CORE", locale: "ru", columns: ["query"], sort: "TEXT_ASC" });
      const exportJob = exported;
      const completed = await waitFor(`projects/${project.id}/exports/${exportJob.id}`, "COMPLETED");
      assert.equal(completed.rowCount, 4);
      const file = await api.get(`/app/api/projects/${project.id}/exports/${exportJob.id}/file`);
      assert.equal(file.status(), 200); assert.ok((await file.body()).byteLength > 100);
      const receipts = await remote.prisma.remoteWorkTask.findMany({ where: { nodeId: remote.nodeId, workspaceId: area.id, state: "COMPLETED" }, select: { capability: true } });
      for (const capability of ["IMPORT", "EXPORT", "INSPECTION"]) assert.ok(receipts.some((row) => row.capability === capability), `${capability} must execute on the fixture agent, not silently fall back to main`);
    }
    const dimensionKey = "GOOGLE|RU|1011969|ru|DESKTOP";
    const reportInput = { dimensionKey, mode: "SEO", observedFrom: "2026-09-01T00:00:00.000Z", observedBefore: "2026-10-01T00:00:00.000Z", dateLimit: 31, limit: 100, sort: "POSITION_ASC", includeUntracked: false };
    const report = await call("POST", `projects/${project.id}/rank-workbench/positions`, reportInput);
    assert.deepEqual(report.rows.map(({ query }) => query), ["Свежий второй", "Свежий четвёртый", "Старый первый"]);
    const withUntracked = await call("POST", `projects/${project.id}/rank-workbench/positions`, { ...reportInput, includeUntracked: true });
    assert.equal(withUntracked.rows.find(({ query }) => query.startsWith("Неотслеживаемый"))?.isTracked, false);
    const history = await call("GET", `projects/${project.id}/keywords/position-history?includeUntracked=true&rankDimensionKey=${encodeURIComponent(dimensionKey)}`);
    assert.equal(history.points.at(-1).top100KeywordCount, 4);
    assert.equal(history.points.at(-1).top50KeywordCount, 3);

    const context = await browser.newContext({ storageState: await api.storageState() });
    await context.addCookies([{ name: "seo_workspace", value: area.id, url: base }, { name: "seo_project", value: project.id, url: base }]);
    const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/app/rankings`, { waitUntil: "networkidle" });
    await page.locator(".rankings-matrix tbody tr").first().waitFor();
    assert.equal(await page.locator(".rankings-matrix tbody tr").first().locator("th > strong").innerText(), "Свежий второй");
    const font = await page.locator(".rankings-matrix tbody th > strong").first().evaluate((element) => ({ size: parseFloat(getComputedStyle(element).fontSize), weight: getComputedStyle(element).fontWeight }));
    assert.ok(font.size >= 13); assert.equal(font.weight, "550");
    await page.getByRole("button", { name: "Показать неотслеживаемые", exact: true }).click();
    await page.locator(".rankings-untracked-icon").waitFor();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByRole("button", { name: "Скрыть неотслеживаемые", exact: true }).getAttribute("aria-pressed"), "true");
    const statistics = page.getByRole("button", { name: "Статистика", exact: true });
    assert.equal(await statistics.innerText(), "");
    const summary = page.locator(".rankings-summary");
    assert.equal(await summary.getByText("Топ-10", { exact: true }).count(), 0);
    assert.equal(await summary.getByText("Топ-30", { exact: true }).count(), 0);
    const summaryTops = await summary.locator(":scope > div").evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    assert.equal(new Set(summaryTops).size, 1);
    if (await statistics.getAttribute("aria-expanded") !== "true") await statistics.click();
    const distribution = page.locator(".rankings-distribution-items");
    assert.equal(await distribution.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 2);
    for (const label of ["Топ-1", "Топ-3", "Топ-5", "Топ-10", "Топ-100"]) {
      assert.equal(await distribution.getByText(label, { exact: true }).count(), 1);
    }
    assert.equal(await distribution.getByText("Топ-50", { exact: true }).count(), 0);
    await page.screenshot({ path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/rank-distribution.png`, fullPage: true });
    await page.getByRole("button", { name: /^Период:/u }).click();
    for (const label of ["6 месяцев", "1 год", "2 года"]) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Глобальный поиск" });
    await search.fill("nccenter.ru");
    await page.getByRole("option", { name: new RegExp(second.name) }).waitFor();
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.keyboard.press("Enter")]);
    await page.waitForFunction((id) => document.cookie.includes(`seo_project=${id}`), second.id);
    assert.equal(new URL(page.url()).pathname, "/app/rankings");
    assert.equal(await page.locator('.sidebar a').filter({ hasText: "Инструменты" }).count(), 0);
    await page.locator('.sidebar a').filter({ hasText: "Поисковая выдача" }).click();
    await page.waitForURL(`**/projects/${second.id}/tools/serp`);
    await page.keyboard.press("Control+k"); await search.fill("tochka-snab.ru");
    await page.getByRole("option", { name: new RegExp(project.name) }).click();
    await page.waitForURL(`**/projects/${project.id}/tools/serp`);
    await page.goto(`${base}/app`, { waitUntil: "networkidle" });
    const top50 = page.getByRole("button", { name: "Топ-50", exact: true });
    await top50.click(); await page.reload({ waitUntil: "networkidle" });
    assert.equal(await top50.getAttribute("aria-pressed"), "false");
    assert.equal(await page.getByRole("button", { name: "Топ-100", exact: true }).count(), 1);
    await page.screenshot({ path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/dashboard-search-rank.png`, fullPage: true });
    await page.keyboard.press("Control+k"); await search.fill("");
    await page.screenshot({ path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/global-search.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.mobile-nav a').filter({ hasText: "Поисковая выдача" }).waitFor({ state: "visible" });
    await page.locator('.mobile-nav a').filter({ hasText: "Обход сайта" }).waitFor({ state: "visible" });
    await page.keyboard.press("Control+k");
    assert.equal(await search.isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile search overflows the viewport");
    await page.screenshot({ path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/global-search-mobile.png`, fullPage: true });
    if (remote) {
      // Two public HTTPS reads of our own test host, no provider request.
      const crawlProject = await call("PATCH", `projects/${second.id}`, { domain: "144.31.221.28" }, second.version);
      const crawl = await call("POST", `projects/${crawlProject.id}/crawls`, { purpose: "TECHNICAL_AUDIT", startUrls: ["https://144.31.221.28/ru"], sitemapUrls: [], maxUrls: 1, maxDepth: 0, maxRuntimeSeconds: 60, requestsPerMinute: 60, obeyRobots: true });
      const completedCrawl = await waitFor(`projects/${crawlProject.id}/crawls/${crawl.id}`, ["COMPLETED", "PARTIALLY_COMPLETED"]);
      assert.equal(completedCrawl.processedUrls, 1);
      const remotePages = await remote.prisma.remoteWorkTask.count({ where: { nodeId: remote.nodeId, operationId: crawl.id, capability: "CRAWL", state: "COMPLETED" } });
      assert.ok(remotePages >= 2, "robots and page must execute remotely and persist successfully");
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await api.dispose(); }
});

test("HTTPS compact worker cards, create/settings modals and live details drawer", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 60000
}, async () => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL;
  const fixtures = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: fixtures[1].storageState, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const capabilities = ["RANK", "WORDSTAT", "RESEARCH", "AI_ANSWER", "CLUSTERING", "CRAWL", "IMPORT", "EXPORT", "INSPECTION"];
    const knownToken = `wn_${"a".repeat(43)}`;
    const online = { id: randomUUID(), name: "Офисный узел", enabled: true, draining: false, capabilities, maxHttpSlots: 32, maxCpuSlots: 2, useEnvCapacity: false, tokenFingerprint: createHash("sha256").update(knownToken).digest("hex").slice(0,16), reportedHttpSlots: 32, reportedRankSlots: 20, reportedCpuSlots: 2, reportedMemoryBytes: String(8 * 1024 ** 3), reportedBuildHash: "a".repeat(64), expectedBuildHash: "a".repeat(64), activeWorkItems: 4, online: true, lastHeartbeatAt: new Date().toISOString(), protocolVersion: 1, reportedCapabilitySlots: { RANK: 20, WORDSTAT: 10, RESEARCH: 10, AI_ANSWER: 5, CLUSTERING: 2, CRAWL: 8, IMPORT: 2, EXPORT: 2, INSPECTION: 1 }, activeAssignments: [{ jobId: randomUUID(), capability: "RANK", searchEngine: "YANDEX", activeTasks: 4 }] };
    const offline = { ...online, id: randomUUID(), name: "Нет связи с узлом", reportedBuildHash: "b".repeat(64), online: false, activeWorkItems: 0, activeAssignments: [] };
    let reads = 0, configured, deleted = false, deleteAttempts = 0;
    const mutations = [];
    await page.route("**/admin/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data;
      if (path.endsWith("/me")) data = { userId: fixtures[1].userId, email: fixtures[1].email, displayName: "Проверка интерфейса", roles: ["OPERATIONS"], mfaVerified: true, authenticatedAt: new Date().toISOString() };
      else if (path.endsWith("/configuration")) { configured = route.request().postDataJSON(); Object.assign(online, configured); data = online; }
      else if (path.endsWith("/enabled") || path.endsWith("/draining")) { mutations.push(path); Object.assign(online, route.request().postDataJSON()); data = online; }
      else if (route.request().method() === "DELETE") {
        assert.deepEqual(route.request().postDataJSON(), { confirmed: true }); deleteAttempts++;
        if (deleteAttempts === 1) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Временная ошибка удаления" } }) }); return; }
        deleted = true; data = { id: online.id, deletedAt: new Date().toISOString() };
      }
      else { reads++; data = deleted ? [offline] : [online, offline]; }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data, meta: { requestId: randomUUID() } }) });
    });
    await page.goto(`${base}/admin?screen=workers`, { waitUntil: "networkidle" });
    const cards = page.locator(".worker-card"); await cards.first().waitFor();
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Обновить", exact: true }).count(), 0);
    assert.ok((await cards.first().boundingBox()).width < 600);
    assert.equal(await page.locator(".worker-state-offline .worker-connectivity").innerText(), "Нет связи");
    assert.match(await cards.first().innerText(), /Сборка a{12} · актуальна/u);
    assert.match(await cards.nth(1).innerText(), /Сборка b{12} · обновить/u);
    await page.getByRole("button", { name: "Создать воркер", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Создать воркер", exact: true });
    await create.waitFor(); assert.equal(await create.getByRole("checkbox").count(), 10);
    assert.equal(await create.getByRole("checkbox", { name: "Брать слоты из .env воркера" }).isChecked(), true);
    await create.getByLabel("Название", { exact: true }).fill("Новый узел");
    await page.keyboard.press("Escape"); await create.waitFor({ state: "hidden" });
    await cards.first().getByRole("button", { name: "Настройки", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Настройки воркера", exact: true }); await settings.waitFor();
    await settings.getByLabel("Позиции и выдача: слоты", { exact: true }).fill("20");
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await settings.waitFor({ state: "hidden" }); assert.equal(configured.capabilityLimits.RANK, 20);
    await cards.first().getByRole("button", { name: "Подробнее", exact: true }).click();
    const detail = page.getByRole("dialog", { name: online.name, exact: true }); await detail.waitFor();
    assert.match(await detail.innerText(), /Сборка воркера[\s\S]*Сборка центра/u);
    assert.match(await detail.innerText(), /Ресурсы[\s\S]*Частотности[\s\S]*Операции[\s\S]*Яндекс/u);
    await detail.getByRole("textbox", { name: "Ключ воркера для проверки" }).fill(knownToken);
    await detail.getByRole("button", { name: "Сверить ключ" }).click();
    await detail.getByRole("status").getByText(/Ключ совпадает/u).waitFor();
    const bounds = await detail.boundingBox(); assert.ok(Math.abs(bounds.x + bounds.width - 1440) < 2);
    await page.screenshot({ path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/admin-worker-details.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/admin-worker-cards.png`, fullPage: true });
    const before = reads; await page.waitForTimeout(5500); assert.ok(reads > before, "list refreshes without a manual button");
    await cards.first().getByRole("button", { name: "Выключить воркер", exact: true }).click();
    const disable = page.getByRole("dialog", { name: "Выключить воркер?", exact: true }); await disable.waitFor();
    assert.equal(mutations.length, 0); await disable.getByRole("button", { name: "Отмена", exact: true }).click(); assert.equal(mutations.length, 0);
    await cards.first().getByRole("button", { name: "Выключить воркер", exact: true }).click();
    await disable.getByRole("button", { name: "Выключить", exact: true }).click(); await disable.waitFor({ state: "hidden" }); assert.equal(mutations.length, 1);
    await cards.first().getByRole("button", { name: "Включить воркер", exact: true }).click(); await cards.first().getByRole("button", { name: "Завершить текущие задачи", exact: true }).click();
    const drain = page.getByRole("dialog", { name: "Остановить воркер плавно?", exact: true }); await drain.waitFor();
    assert.equal(mutations.length, 2); await drain.getByRole("button", { name: "Остановить плавно", exact: true }).click(); await drain.waitFor({ state: "hidden" }); assert.equal(mutations.length, 3);
    await cards.first().getByRole("button", { name: "Удалить воркер", exact: true }).click();
    const remove = page.getByRole("dialog", { name: "Удалить воркер?", exact: true }); await remove.waitFor(); assert.equal(deleteAttempts, 0);
    await remove.getByRole("button", { name: "Отмена", exact: true }).click(); assert.equal(deleteAttempts, 0);
    await cards.first().getByRole("button", { name: "Удалить воркер", exact: true }).click();
    await remove.getByRole("button", { name: "Удалить", exact: true }).click(); await remove.getByRole("alert").waitFor();
    assert.equal(await cards.count(), 2); await remove.getByRole("button", { name: "Удалить", exact: true }).click();
    await remove.waitFor({ state: "hidden" }); assert.equal(await cards.count(), 1); await page.reload({ waitUntil: "networkidle" }); assert.equal(await cards.count(), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

async function* historyRows(keywords) {
  for (const keyword of keywords) {
    const old = keyword.textOriginal === "Старый первый";
    const position = old ? 1 : keyword.textOriginal === "Свежий второй" ? 2 : keyword.textOriginal === "Свежий четвёртый" ? 4 : 80;
    yield { keywordId: keyword.id, text: keyword.textOriginal, keywordLanguage: "ru", createdAt: keyword.createdAt,
      dimension: { key: "GOOGLE|RU|1011969|ru|DESKTOP", searchEngine: "GOOGLE", countryCode: "RU", regionCode: "1011969", regionLabel: "Москва", language: "ru", device: "DESKTOP" },
      snapshots: [{ searchEngine: "GOOGLE", observedDate: old ? "2026-09-28" : "2026-09-29", found: true, position }] };
  }
}

test("admin dark presentation uses shared selects without granting staff access", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 60000
}, async () => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL;
  const fixtures = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: fixtures[1].storageState });
  const browser = await chromium.launch({ headless: true });
  try {
    assert.equal((await api.get("/admin/api/me")).status(), 403, "fixture must not gain a platform role");
    const unauthorizedDeletion = await api.delete(`/admin/api/worker-nodes/${randomUUID()}`, { headers: { Origin: base }, data: { confirmed: true } });
    assert.equal(unauthorizedDeletion.status(), 403, "DELETE must reach the role guard, not fail in the BFF method allowlist");
    assert.notEqual((await unauthorizedDeletion.json()).error?.message, "API route not found");
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const unauthorizedCancel = await api.post(`/admin/api/operations/${randomUUID()}/cancel`, { headers: { Origin: base, "X-CSRF-Token": csrf }, data: { confirmed: true, confirmId: randomUUID(), reason: "Ручная остановка из административной панели" } });
    assert.equal(unauthorizedCancel.status(), 403, "operation cancellation must reach the role guard");
    assert.notEqual((await unauthorizedCancel.json()).error?.message, "API route not found");
    const context = await browser.newContext({ storageState: await api.storageState() });
    const errors = [];
    const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
    const operation = { id: randomUUID(), workspaceId: randomUUID(), type: "MANUAL_RANK_CHECK", status: "RUNNING", stage: "WAITING_EXECUTION_GRANT", provider: "XMLSTOCK", searchEngine: "YANDEX", searchSource: "LIVE", connection: { label: "Личный ключ", displayHint: "••••1234" }, workers: [{ name: "Офисный воркер", activeTasks: 4, status: "ONLINE", assignedOperations: 2, nodeId: randomUUID() }], progress: { current: "25", total: "100", unit: "KEYWORD" }, result: { found: 20, notFound: 5 }, attempt: 1, maxAttempts: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), workspace: { id: randomUUID(), name: "Рабочая область" }, project: { id: randomUUID(), name: "Тестовый проект", domain: "example.org" }, actor: null };
    const seasonality = { ...operation, id: randomUUID(), type: "FREQUENCY_COLLECTION", frequencyMode: "SEASONALITY", status: "CANCELLED", searchSource: undefined, progress: { current: "8", total: "65", unit: "keywords" }, result: { failed: 31 }, errorCode: "PROVIDER_LOW_BALANCE" };
    const frequency = { ...seasonality, id: randomUUID(), frequencyMode: "FREQUENCY", progress: { current: "10", total: "65", unit: "keywords" } };
    const waiting = { ...frequency, id: randomUUID(), status: "RETRY_SCHEDULED", stage: "waiting_provider_capacity", progress: { current: "52", total: "93", unit: "keywords" }, result: {}, errorCode: "PROVIDER_CONCURRENCY_LIMITED" };
    // Presentation-only fixture. No API/DB role is created or bypassed.
    let cancellations = 0;
    let operationReads = 0;
    await page.route("**/admin/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/operations")) operationReads++;
      if (path.endsWith(`/operations/${operation.id}/cancel`)) {
        assert.equal(route.request().method(), "POST");
        const command = parseAdminCancelOperationCommand(route.request().postDataJSON());
        assert.equal(command.confirmId, operation.id);
        assert.equal(command.reason, "Ручная остановка из административной панели");
        operation.status = "CANCEL_REQUESTED"; cancellations++;
        await route.fulfill({ json: { data: { id: operation.id, status: operation.status } } });
        return;
      }
      const data = path.endsWith("/me") ? { userId: fixtures[1].userId, email: fixtures[1].email, displayName: "Проверка интерфейса", roles: ["OPERATIONS"], mfaVerified: true, authenticatedAt: new Date().toISOString() } : { data: [operation, seasonality, frequency, waiting], totals: { total: 4, active: 2, completed: 2, attention: 0 }, types: [{ type: "MANUAL_RANK_CHECK", count: 1 }, { type: "FREQUENCY_COLLECTION", count: 3 }] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data, meta: { requestId: randomUUID() } }) });
    });
    await page.goto(`${base}/admin?screen=operations`, { waitUntil: "domcontentloaded" });
    await page.getByText("Офисный воркер", { exact: true }).first().waitFor();
    assert.equal(await page.locator(".operation-worker-card.operation-worker-online").first().getByText("2 операции · 4 выдано запросов").count(), 1);
    const workerCopy = await page.locator(".operation-worker-card .operation-worker-copy").first().boundingBox();
    assert.ok(workerCopy && workerCopy.width >= 100, "worker name and counts must fit without breaking each word");
    assert.equal(await page.getByText(/Яндекс Live · Личный ключ/u).count(), 1);
    assert.equal(await page.getByText("Сезонность Wordstat", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Сбор частотности", { exact: true }).count(), 2);
    assert.equal(await page.locator(".operation-kind .provider-logo.xmlstock").count(), 4);
    assert.equal(await page.getByText("Недостаточно средств на балансе провайдера").count(), 2);
    const waitingRow = page.locator(".operation-row").filter({ hasText: "52 из 93" });
    assert.equal(await waitingRow.getByText("Ожидает", { exact: true }).count(), 1);
    assert.equal(await waitingRow.getByText("Ожидает свободный слот").count(), 2);
    assert.equal(await waitingRow.getByText("PROVIDER_CONCURRENCY_LIMITED").count(), 0);
    await waitingRow.getByRole("button", { name: "Детали", exact: true }).click();
    const waitingDrawer = page.getByRole("dialog", { name: new RegExp(waiting.id, "u") });
    await waitingDrawer.getByText("Причина ожидания").waitFor();
    assert.equal(await waitingDrawer.getByText("PROVIDER_CONCURRENCY_LIMITED").count(), 0);
    await waitingDrawer.getByRole("button", { name: "Закрыть" }).click();
    assert.equal(await page.getByRole("combobox", { name: /Язык|Language/u }).count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "Интервал обновления", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Обновить", exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    const backgroundPage = await context.newPage();
    await backgroundPage.goto(`${base}/ru`, { waitUntil: "domcontentloaded" });
    const readsBeforeBackground = operationReads;
    await page.waitForTimeout(2_300);
    assert.ok(operationReads > readsBeforeBackground, "an inactive admin tab must keep refreshing");
    await backgroundPage.close();
    await page.locator(".operation-row").filter({ hasText: "Проверка позиций" }).getByRole("button", { name: "Остановить", exact: true }).click();
    const confirmation = page.locator("dialog[open].admin-action-dialog");
    assert.equal(await confirmation.getByRole("button", { name: "Подтвердить", exact: true }).isEnabled(), false);
    await confirmation.getByRole("checkbox", { name: "Подтверждаю действие", exact: true }).check();
    assert.equal(await confirmation.getByRole("button", { name: "Подтвердить", exact: true }).isEnabled(), true);
    await confirmation.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(cancellations, 1);
    await page.locator(".operation-row").filter({ hasText: "Проверка позиций" })
      .getByRole("button", { name: "Остановить", exact: true }).waitFor({ state: "hidden" });
    await page.addStyleTag({ content: ".operation-panel { min-height: 1800px }" });
    await page.evaluate(() => window.scrollTo(0, 100));
    const beforeDrawer = await page.evaluate(() => window.scrollY);
    assert.ok(beforeDrawer >= 90);
    await page.locator(".operation-row").filter({ hasText: "Проверка позиций" }).getByRole("button", { name: "Детали", exact: true }).click();
    await page.getByRole("dialog", { name: new RegExp(operation.id, "u") }).getByRole("button", { name: "Закрыть" }).click();
    assert.equal(await page.evaluate(() => window.scrollY), beforeDrawer, "closing details must keep the list scroll position");
    const typeSelect = page.getByRole("combobox", { name: "Тип операции" });
    await typeSelect.click();
    await page.getByRole("option", { name: /Частотность и сезонность/u }).click();
    await typeSelect.click();
    assert.equal(await page.getByRole("option", { name: /Проверка позиций/u }).count(), 1);
    assert.equal(await page.getByRole("option", { name: /Частотность и сезонность/u }).count(), 1);
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTitle("Данные обновляются автоматически каждую секунду").waitFor();
    const color = await page.locator(".admin-root").evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.equal(color, "rgb(32, 32, 32)");
    await page.screenshot({ path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/admin-operation-theme.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await api.dispose(); }
});
