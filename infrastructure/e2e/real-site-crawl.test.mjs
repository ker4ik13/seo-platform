import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { chromium, request } from "playwright";

test("real neuroluv sitemap with a 5000 URL budget completes a bounded SEO crawl through HTTPS", { skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 240_000 }, async (t) => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
  assert.equal(base, "https://144.31.221.28:3000");
  const [user] = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: user.storageState });
  const browser = await chromium.launch({ headless: true }); t.after(async () => { await browser.close(); await api.dispose(); });
  async function call(method, path, data) {
    const csrf = (await api.storageState()).cookies.find((cookie) => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch("/app/api/" + path, { method, headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() }, ...(data ? { data } : {}) });
    const body = await response.json(); assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${body.error?.code ?? ""}`); return body.data;
  }
  const workspace = await call("POST", "workspaces", { name: "Контроль реального обхода", country: "RU", locale: "ru", timezone: "Europe/Moscow", billingCurrency: "RUB" });
  const project = await call("POST", `workspaces/${workspace.id}/projects`, { name: "Проверка neuroluv.ru", domain: "neuroluv.ru", locale: "ru", timezone: "Europe/Moscow" });
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base }, { name: "seo_project", value: project.id, url: base }]);
  const page = await context.newPage(), errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/app/projects/${project.id}/tools/http-status-checker`);
  await page.getByLabel("Лимит страниц", { exact: true }).fill("5000");
  await page.getByRole("combobox", { name: "Скорость на домен", exact: true }).click(); await page.getByRole("option", { name: "4 страницы/с", exact: true }).click();
  await page.getByRole("checkbox", { name: "Находить страницы по внутренним ссылкам", exact: true }).uncheck();
  await page.locator("summary").filter({ hasText: "Глубина, пути и параметры URL" }).click();
  await page.getByLabel("Включить пути", { exact: true }).fill("/\n/ai\n/ai/**");
  await page.getByRole("combobox", { name: "Параметры URL", exact: true }).click(); await page.getByRole("option", { name: "Убирать все параметры", exact: true }).click();
  const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/projects/${project.id}/crawls`));
  await page.getByRole("button", { name: "Запустить обход", exact: true }).click();
  const response = await created; assert.equal(response.status(), 202); let crawl = (await response.json()).data;
  assert.equal(crawl.config.maxUrls, 5000); assert.equal(crawl.config.purpose, "TECHNICAL_AUDIT"); assert.equal(crawl.config.requestsPerMinute, 240);
  for (let attempt = 0; attempt < 180; attempt++) { crawl = await call("GET", `projects/${project.id}/crawls/${crawl.id}`); if (!["QUEUED", "RUNNING"].includes(crawl.status)) break; await delay(1000); }
  assert.equal(crawl.status, "COMPLETED"); assert.ok(crawl.processedUrls >= 20 && crawl.processedUrls <= 30); assert.equal(crawl.failedUrls, 0);
  await page.getByRole("heading", { name: "Обход завершён", exact: true }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: output + "/real-crawl-completed.png" });
  const pages = await call("GET", `projects/${project.id}/pages?limit=100`); assert.equal(pages.pages.length, crawl.processedUrls);
  await page.goto(`${base}/app/projects/${project.id}/pages`); await page.locator("tr[data-page-id]").first().waitFor(); await page.screenshot({ path: output + "/real-crawl-pages.png" });
  assert.deepEqual(errors, []);
  await writeFile(output + "/real-crawl-result.json", JSON.stringify({ status: crawl.status, processed: crawl.processedUrls, successful: crawl.successfulUrls, failed: crawl.failedUrls, maxUrls: crawl.config.maxUrls, projectId: project.id, browserErrors: errors }, null, 2), { mode: 0o600 });
});
