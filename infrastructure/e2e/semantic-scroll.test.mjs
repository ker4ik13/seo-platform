import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium, request } from "playwright";

const base = process.env.SEO_PLATFORM_PUBLIC_URL;
const output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;

test("semantic scroll: 800 rows, 100-row pages, rich cells and two open tabs remain stable", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
  timeout: 240_000
}, async t => {
  assert.ok(base?.startsWith("https://"));
  assert.ok(output?.startsWith("/"));
  assert.ok(process.env.SEO_PLATFORM_SESSION_FIXTURES);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const [fixture] = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  assert.match(fixture.email, /^e2e-load-[0-9a-f-]+@example\.invalid$/u);
  const api = await request.newContext({ baseURL: base, storageState: fixture.storageState });
  const browser = await chromium.launch({ headless: true });
  let lastPage;
  t.after(async () => {
    if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: path.join(output, "semantic-scroll-last.png") });
    await browser.close();
    await api.dispose();
  });
  async function command(method, endpoint, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, {
      method, headers: { Origin: base, "Idempotency-Key": randomUUID(), ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
      ...(data === undefined ? {} : { data })
    });
    const body = await response.json();
    assert.ok(response.ok(), `${method} ${endpoint}: ${response.status()} ${body.error?.code ?? ""}`);
    return body.data;
  }
  const workspace = await command("POST", "workspaces", { name: "Scroll regression", country: "RU", locale: "ru", timezone: "Europe/Berlin", billingCurrency: "RUB" });
  await command("POST", `workspaces/${workspace.id}/billing/trial`);
  const project = await command("POST", `workspaces/${workspace.id}/projects`, { name: "Scroll regression", domain: "example.com", locale: "ru", timezone: "Europe/Berlin" });
  for (let start = 0; start < 800; start += 200) {
    await command("POST", `projects/${project.id}/keywords/bulk`, {
      items: Array.from({ length: 200 }, (_, i) => ({ text: `Запрос ${String(start + i).padStart(4, "0")} ${"длинное название ".repeat(i % 4 + 1)}`, language: "ru", priority: 0, isFavorite: false, isTracked: true, tagNames: [] })),
      duplicatePolicy: "SKIP_EXISTING"
    });
  }
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 950 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base }, { name: "seo_project", value: project.id, url: base }]);
  await context.addInitScript(() => {
    window.semanticReadEvents = [];
    for (const name of ["seo:project-semantic-mutation"]) {
      window.addEventListener(name, () => window.semanticReadEvents.push(name));
    }
  });
  let density = "COMFORTABLE";
  const columns = ["query", "tags", "yandexPosition", "yandexRelevantUrl", "targetUrl", "source"];
  await context.route(`**/app/api/projects/${project.id}/semantic-saved-views`, route => route.fulfill({ json: { data: [{
    id: randomUUID(), ownerId: fixture.userId, name: "__project_table_layout__", scope: "PRIVATE", version: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    config: { schemaVersion: 4, filters: {}, sort: "CREATED_DESC", columns, density, pageSize: 100, columnWidths: { tags: 90, targetUrl: 90, yandexRelevantUrl: 100 } }
  }] } }));
  // Real keyset pages, with deliberately heterogeneous provider projections.
  await context.route(`**/app/api/projects/${project.id}/keywords/list`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.data)) body.data = body.data.map((row, i) => ({
      ...row, hasNote: i % 2 === 0, isFavorite: i % 3 === 0,
      tags: i % 4 === 0 ? [] : ["Длинный тег", "Ещё тег", "Третий тег"],
      targetUrl: `https://example.com/${"long-target/".repeat(i % 3 * 10 + 1)}`,
      positions: i % 5 === 0 ? [] : [{ searchEngine: "YANDEX", found: true, position: 4, previousPosition: 8, rankingUrl: `https://example.com/${"long-ranking/".repeat(15)}`, observedAt: new Date().toISOString() }]
    }));
    await route.fulfill({ response, json: body });
  });
  const page = await context.newPage();
  const peer = await context.newPage();
  lastPage = page;
  const errors = [], requests = [];
  for (const tab of [page, peer]) {
    tab.on("pageerror", error => errors.push(error.message));
    tab.on("request", req => {
      if (new URL(req.url()).pathname.endsWith("/keywords/list")) requests.push({ tab: tab === page ? "main" : "peer", ...req.postDataJSON()?.query });
    });
  }
  const report = [];
  for (const mode of ["COMFORTABLE", "COMPACT"]) {
    density = mode;
    await Promise.all([page.goto(`${base}/app/semantics`), peer.goto(`${base}/app/semantics`)]);
    const wrap = page.locator(".semantic-core > .semantic-table-wrap");
    await page.locator(".semantic-table tbody tr[data-presence-row-id]").first().waitFor();
    await peer.locator(".semantic-table tbody tr[data-presence-row-id]").first().waitFor();
    await page.waitForTimeout(1500);
    const requestStart = requests.length;
    // Wait for each boundary page, then assert both scrollTop and row geometry.
    for (let batch = 1; batch <= 8; batch++) {
      const target = (batch * 100 - 20) * (mode === "COMPACT" ? 28 : 34);
      const before = await wrap.evaluate((el, target) => { el.scrollTop = target; return el.scrollTop; }, target);
      await page.waitForTimeout(350);
      const after = await wrap.evaluate(el => ({ top: el.scrollTop, heights: [...el.querySelectorAll("tr[data-presence-row-id]")].map(row => row.getBoundingClientRect().height) }));
      assert.ok(Math.abs(after.top - before) <= 1, `${mode} batch ${batch}: scroll jumped ${before} -> ${after.top}`);
      assert.ok(after.heights.length > 0);
      assert.ok(after.heights.every(height => Math.abs(height - (mode === "COMPACT" ? 28 : 34)) < 0.1), `${mode}: row heights ${[...new Set(after.heights)]}`);
      if (batch < 8) {
        await wrap.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.waitForFunction(expected => {
          const text = document.querySelector(".semantic-table-footer > span")?.textContent ?? "";
          return Number(text.match(/\d+/u)?.[0]) >= expected;
        }, (batch + 1) * 100);
      }
      report.push({ mode, batch, before, after: after.top });
    }
    // Scroll back through already loaded rows and wait for any delayed invalidation.
    for (const top of [12000, 6000, 3000, 0]) {
      await wrap.evaluate((el, top) => { el.scrollTop = top; }, top);
      await page.waitForTimeout(150);
      assert.ok(Math.abs(await wrap.evaluate(el => el.scrollTop) - top) <= 1);
    }
    await page.waitForTimeout(1500);
    assert.equal(requests.slice(requestStart).filter(req => !req.cursor).length, 0, "Scrolling must not reload the first page in either tab");
    const cursorRequests = requests.slice(requestStart).filter(req => req.tab === "main" && req.cursor);
    assert.equal(new Set(cursorRequests.map(req => req.cursor)).size, 7);
    assert.equal(cursorRequests.length, 7);
    for (const tab of [page, peer]) assert.deepEqual(await tab.evaluate(() => window.semanticReadEvents), []);
    await page.screenshot({ path: path.join(output, `semantic-scroll-${mode.toLowerCase()}.png`) });
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "semantic-scroll-report.json"), JSON.stringify({ report, requests: requests.length, errors }, null, 2));
});
