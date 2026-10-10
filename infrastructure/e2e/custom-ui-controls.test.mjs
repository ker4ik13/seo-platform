import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { chromium, request } from "playwright";

test("custom locale selector persists and calendar supports keyboard navigation through HTTPS", { skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 120_000 }, async (t) => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
  assert.equal(base, "https://144.31.221.28:3000");
  const [user] = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: user.storageState });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await api.dispose(); });
  async function command(method, path, data) {
    const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch("/app/api/" + path, { method, headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() }, data });
    const body = await response.json(); assert.ok(response.ok(), `${path}: ${response.status()} ${body.error?.code ?? ""}`); return body.data;
  }
  const workspace = await command("POST", "workspaces", { name: "Контроль общих компонентов", country: "RU", locale: "ru", timezone: "Europe/Moscow", billingCurrency: "RUB" });
  const project = await command("POST", `workspaces/${workspace.id}/projects`, { name: "Календарь", domain: "example.com", locale: "ru", timezone: "Europe/Moscow" });
  await command("PATCH", "me/preferences", { locale: "en" });
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Moscow" });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base }, { name: "seo_project", value: project.id, url: base }, { name: "seo_ui_locale", value: "en", url: base }]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/app/semantics");
  await page.locator(".avatar-button").click();
  await page.getByRole("combobox", { name: "Interface language", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".avatar-button").getAttribute("aria-expanded"), "true", "Escape closes the child select before the account menu");
  await page.getByRole("combobox", { name: "Interface language", exact: true }).click();
  const changed = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/me/preferences"));
  await page.getByRole("option", { name: "Русский", exact: true }).click();
  assert.equal((await changed).status(), 200);
  await page.reload(); assert.equal(await page.locator("html").getAttribute("lang"), "ru");
  await page.goto(`${base}/app/projects/${project.id}/pages`);
  const trigger = page.getByRole("combobox", { name: "Дата съёма для карты страниц", exact: true });
  await trigger.focus(); await page.keyboard.press("ArrowDown");
  const panel = page.locator("[data-custom-date-panel]"); await panel.waitFor();
  const before = await page.evaluate(() => document.activeElement?.getAttribute("data-date-key"));
  assert.ok(before, "opening the calendar focuses a date");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("data-date-key")), before);
  await page.screenshot({ path: output + "/custom-calendar.png" });
  await page.keyboard.press("Escape"); assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.deepEqual(errors, []);
  await writeFile(output + "/custom-controls-result.json", JSON.stringify({ localePersisted: true, keyboardCalendar: true, browserErrors: errors }, null, 2), { mode: 0o600 });
});
