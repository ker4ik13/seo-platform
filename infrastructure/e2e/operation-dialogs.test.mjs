import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium, request } from "playwright";

const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
test("operation dialogs through Caddy: RU/EN, real scope reads, responsive empty-provider states and no accidental paid launch", { skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 360_000 }, async t => {
  assert.ok(base?.startsWith("https://")); assert.ok(output?.startsWith("/"));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const fixture = process.env.SEO_PLATFORM_SESSION_FIXTURES ? JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"))[12] : undefined;
  if (fixture) assert.match(fixture.email, /^e2e-load-[0-9a-f-]+@example\.invalid$/u);
  const api = await request.newContext({ baseURL: base, ...(fixture ? { storageState: fixture.storageState } : {}) });
  const browser = await chromium.launch({ headless: true });
  let page;
  t.after(async () => { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, "last-screen.png") }); await writeFile(path.join(output, "last-dom.html"), await page.content(), { mode: 0o600 }); } await browser.close(); await api.dispose(); });
  async function command(method, endpoint, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, { method, headers: { Origin: base, "Idempotency-Key": randomUUID(), ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, ...(data === undefined ? {} : { data }) });
    const body = await response.json(); assert.ok(response.ok(), `${method} ${endpoint.split("/")[0]}: ${response.status()} ${body.error?.code ?? ""}`); return body.data;
  }
  if (!fixture) await command("POST", "auth/register", { email: `dialogs-${randomUUID()}@example.invalid`, password: `${randomBytes(24).toString("base64url")}!Aa9`, displayName: "Dialog audit", country: "RU", locale: "ru", timezone: "Europe/Berlin", termsVersion: "2026-09-07", privacyVersion: "2026-09-07", marketingVersion: "2026-09-07", termsAccepted: true, privacyAccepted: true, marketingAccepted: false });
  const workspace = await command("POST", "workspaces", { name: "Dialog audit", country: "RU", locale: "ru", timezone: "Europe/Berlin", billingCurrency: "RUB" });
  await command("POST", `workspaces/${workspace.id}/billing/trial`);
  const project = await command("POST", `workspaces/${workspace.id}/projects`, { name: "Настройки", domain: "example.com", locale: "ru", timezone: "Europe/Berlin" });
  await command("POST", `projects/${project.id}/keywords/bulk`, { items: ["сохранить настройки", "новый проект"].map(text => ({ text, language: "ru", priority: 0, isFavorite: false, isTracked: true, tagNames: [] })), duplicatePolicy: "SKIP_EXISTING" });
  const context = await browser.newContext({ storageState: await api.storageState() });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base, secure: true, sameSite: "Lax" }, { name: "seo_project", value: project.id, url: base, secure: true, sameSite: "Lax" }]);
  const credentialId = randomUUID(), bindingId = randomUUID(), now = new Date().toISOString();
  await context.route(`**/app/api/workspaces/${workspace.id}/integrations/routing`, route => route.fulfill({ json: { data: {
    bindings: [{
      id: bindingId, workspaceId: workspace.id, capability: "SERP_RANK_TRACKING", enabled: true,
      routes: [{ id: randomUUID(), bindingId, workspaceId: workspace.id, position: 0, credentialId, provider: "XMLSTOCK", credentialMode: "BYOK_API_KEY", availability: "READY", createdAt: now, updatedAt: now }],
      fallbackPolicy: { mode: "NONE" }, version: 1, createdBy: fixture?.userId ?? randomUUID(), updatedBy: fixture?.userId ?? randomUUID(), createdAt: now, updatedAt: now
    }],
    credentialOptions: [{
      id: credentialId, workspaceId: workspace.id, provider: "XMLSTOCK", label: "Visual XMLStock", mode: "BYOK_API_KEY", status: "ACTIVE",
      capabilities: ["SERP_RANK_TRACKING"],
      quota: { status: "AVAILABLE", unit: "XMLSTOCK_REQUESTS", remaining: 10_000, balance: { amount: "250", currency: "RUB" }, xmlStockPricing: { tariffCode: "OPTIMAL", currency: "RUB", priceUnit: "PER_1000_REQUESTS", pricesPerThousand: { YANDEX_SEARCH_API: "27", YANDEX_LIVE: "20", YANDEX_TURBO: "30", GOOGLE_LIVE: "20", WORDSTAT: "23" }, observedAt: now } }
    }],
    credentialOptionsTruncated: false,
    access: { canUpdateBindings: true, canManageFallback: true }
  } } }));
  page = await context.newPage(); const report = [], errors = [], launches = [];
  page.on("pageerror", error => errors.push({ name: error.name, message: error.message.slice(0, 200) }));
  page.on("request", req => { if (req.method() === "POST" && /\/(frequency-collections|ai-answer-collections|clustering-runs|rank-runs|keyword-research-runs)$/u.test(new URL(req.url()).pathname)) launches.push(new URL(req.url()).pathname); });
  const dialogs = [{ id: "frequency", menu: "wordstat", item: 0 }, { id: "positions", menu: "positions", item: 0 }, { id: "ai", menu: "positions", item: 1 }, { id: "competitors", menu: "competitors", item: 0 }, { id: "ai-competitors", menu: "competitors", item: 1 }, { id: "clustering", menu: "clustering" }];
  for (const locale of ["ru", "en"]) {
    await command("PATCH", "me/preferences", { locale });
    await context.addCookies([{ name: "seo_ui_locale", value: locale, url: base, secure: true, sameSite: "Lax" }]);
    for (const width of (process.env.SEO_PLATFORM_DIALOG_WIDTH ? [Number(process.env.SEO_PLATFORM_DIALOG_WIDTH)] : [1440, 390, 320])) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });
      for (const entry of dialogs) {
        await page.locator(`[data-presence-key="semantic-action:${entry.menu}"]`).click();
        if (entry.item !== undefined) await page.getByRole("menuitem").nth(entry.item).click();
        const modal = page.locator("dialog[open].semantic-modal").last();
        await modal.waitFor(); await page.waitForLoadState("networkidle");
        await page.waitForFunction(() => {
          const dialog = document.querySelector("dialog[open].semantic-modal");
          return dialog && !dialog.querySelector(".semantic-dialog-loading") && !/Loading keywords|Загружаем запросы|Считаем(?:…|\.\.\.)/u.test(dialog.querySelector(".semantic-modal-footer")?.textContent ?? "");
        }, undefined, { timeout: 20_000 });
        if (locale === "ru" && width === 1440 && entry.id === "positions") {
          const stopAfterFound = modal
            .locator(".semantic-xmlstock-depth-mode label")
            .filter({ hasText: "До первой позиции" });
          const top100 = modal
            .locator(".semantic-depth-field label")
            .filter({ hasText: "Топ-100" });
          await stopAfterFound.click();
          await top100.click();
          assert.equal(
            await stopAfterFound.locator("input").isChecked(),
            true,
            "a rapid depth click must not restore STRICT_DEPTH"
          );
        }
        const bounds = await modal.boundingBox();
        assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y >= -1 && bounds.y + bounds.height <= 951, `${entry.id}: modal escapes viewport ${width}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${entry.id}: document overflow`);
        const russian = await modal.evaluate(node => { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), found = []; let current; while ((current = walker.nextNode())) if (/[а-яё]/iu.test(current.textContent) && current.parentElement?.getClientRects().length) found.push(current.textContent.trim()); return [...new Set(found)]; });
        report.push({ locale, width, dialog: entry.id, russian: locale === "en" ? russian : [] });
        await page.screenshot({ path: path.join(output, `${locale}-${width}-${entry.id}.png`) });
        await modal.locator('.semantic-modal-close').click();
        await modal.waitFor({ state: "hidden" });
      }
    }
  }
  await writeFile(path.join(output, "operation-dialogs-report.json"), JSON.stringify({ report, errors, launches }, null, 2), { mode: 0o600 });
  assert.deepEqual(errors, []); assert.deepEqual(launches, []);
  const allowed = new Set(["Настройки", "сохранить настройки", "новый проект"]);
  assert.deepEqual(report.flatMap(row => row.russian.filter(text => !allowed.has(text)).map(text => ({ dialog: row.dialog, text }))), [], "Only unchanged user keywords may remain Russian in English operation dialogs");
});
