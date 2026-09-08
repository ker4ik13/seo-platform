import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium, request } from "playwright";

const enabled = process.env.SEO_PLATFORM_E2E_CONFIRM === "CREATE_TEST_DATA";
const base = process.env.SEO_PLATFORM_PUBLIC_URL;
const output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
test("RU/EN through Caddy: persisted UI preference, untranslated user data, settings and account language", { skip: !enabled, timeout: 240_000 }, async t => {
  assert.ok(base?.startsWith("https://")); assert.ok(output?.startsWith("/"));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const api = await request.newContext({ baseURL: base });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await api.dispose(); });
  async function command(method, endpoint, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, { method, headers: { Origin: base, ...(csrf ? { "X-CSRF-Token": csrf } : {}), "Idempotency-Key": randomUUID() }, ...(data === undefined ? {} : { data }) });
    const body = await response.json(); assert.ok(response.ok(), `${method} ${endpoint.split("/")[0]}: ${response.status()} ${body.error?.code ?? ""}`); return body.data;
  }
  await command("POST", "auth/register", { email: `locale-${randomUUID()}@example.invalid`, password: `${randomBytes(24).toString("base64url")}!Aa9`, displayName: "Настройки", country: "RU", locale: "en", timezone: "Europe/Moscow", termsVersion: "2026-07-01", privacyVersion: "2026-07-01", marketingVersion: "2026-07-01", termsAccepted: true, privacyAccepted: true, marketingAccepted: false });
  const workspace = await command("POST", "workspaces", { name: "Сохранить", country: "RU", locale: "ru", timezone: "Europe/Moscow", billingCurrency: "RUB" });
  await command("POST", `workspaces/${workspace.id}/billing/trial`);
  const project = await command("POST", `workspaces/${workspace.id}/projects`, { name: "Настройки", domain: "example.com", locale: "ru", timezone: "Europe/Moscow" });
  await command("POST", `projects/${project.id}/keywords/bulk`, { items: [{ text: "сохранить настройки", language: "ru", priority: 0, isFavorite: false, isTracked: true, tagNames: [] }], duplicatePolicy: "SKIP_EXISTING" });
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base, secure: true, sameSite: "Lax" }, { name: "seo_project", value: project.id, url: base, secure: true, sameSite: "Lax" }, { name: "seo_ui_locale", value: "en", url: base, secure: true, sameSite: "Lax" }]);
  const page = await context.newPage(), errors = [], report = [];
  page.on("pageerror", error => errors.push({ name: error.name, message: error.message.slice(0, 250) }));
  const screens = ["", "/security", "/workspace", "/team", "/roles", "/integrations", "/notifications", "/billing", "/api", "/projects"];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [index, suffix] of screens.entries()) {
      const response = await page.goto(`${base}/app/settings${suffix}`, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      const heading = await page.locator("h1").innerText();
      assert.ok(!/[а-яё]/iu.test(heading), `Untranslated heading: ${heading}`);
      assert.equal(await page.locator('.settings-tabs a[aria-current="page"]').count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow: ${suffix} / ${width}`);
      const russian = await page.locator("main").evaluate(node => { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), found = []; let current; while ((current = walker.nextNode())) { if (/[а-яё]/iu.test(current.textContent) && current.parentElement?.getClientRects().length) found.push(current.textContent.trim()); } return [...new Set(found)]; });
      report.push({ width, screen: suffix || "overview", heading, russian });
      await page.screenshot({ path: path.join(output, `locale-en-${width}-${index}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });
  await page.getByText("сохранить настройки", { exact: true }).first().waitFor();
  assert.equal(await page.locator(".avatar-copy strong").innerText(), "Настройки");
  await page.locator(".avatar-button").click();
  await page.getByRole("combobox", { name: "Interface language", exact: true }).selectOption("ru");
  await page.waitForFunction(() => document.documentElement.lang === "ru");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("html").getAttribute("lang"), "ru");
  await page.getByText("сохранить настройки", { exact: true }).first().waitFor();
  const unchanged = await command("GET", `projects/${project.id}`);
  assert.equal(unchanged.locale, "ru"); assert.equal(unchanged.name, "Настройки");
  const liveWorkspace = await command("GET", `workspaces/${workspace.id}`);
  assert.equal(liveWorkspace.locale, "ru"); assert.equal(liveWorkspace.name, "Сохранить");
  await writeFile(path.join(output, "localization-report.json"), JSON.stringify({ screens: report, clientErrors: errors }, null, 2), { mode: 0o600 });
  assert.deepEqual(errors, []);
  const authoredData = new Set(["Н", "С", "Настройки", "Current project — Настройки"]);
  const untranslated = report.flatMap(screen => screen.russian.filter(text => !authoredData.has(text)).map(text => ({ screen: screen.screen, text })));
  assert.deepEqual(untranslated, [], "Only original user data may remain Russian in English settings");
});
