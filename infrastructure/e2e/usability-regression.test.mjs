import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import test from "node:test";
import { chromium, request } from "playwright";
import { PrismaService } from "../../backend-core/modules/seo/dist/database/prisma.service.js";
import { loadAppConfig } from "../../backend-core/modules/seo/dist/config/app-config.js";
import { createRankWorkbenchFixture } from "../../backend-core/modules/seo/src/rank-workbench/rank-workbench.fixtures.ts";

test("real HTTPS: large matrices, compact rows, small icons, tooltips and column preferences", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 240_000
}, async t => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
  assert.equal(base, "https://144.31.221.28:3000");
  const [user] = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: user.storageState });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await api.dispose(); });
  async function command(path, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.post("/app/api/" + path, { headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() }, data });
    assert.ok(response.ok(), `Command ${path}: HTTP ${response.status()}`);
    return (await response.json()).data;
  }
  const workspace = await command("workspaces", { name: "UI regression", country: "RU", locale: "ru", timezone: "Europe/Moscow", billingCurrency: "RUB" });
  const domain = "geometry-" + randomUUID().slice(0, 8) + ".example.invalid";
  const project = await command(`workspaces/${workspace.id}/projects`, { name: "Большая таблица", domain, locale: "ru", timezone: "Europe/Moscow" });
  const env = parseEnv(await readFile("/home/dev/.local/share/seo-platform-runtime/runtime.env", "utf8"));
  const prisma = new PrismaService(loadAppConfig({ ...env, NODE_ENV: "test", DATABASE_URL: `postgresql://seo_owner:${encodeURIComponent(env.SEO_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/seo_db` }));
  try { await createRankWorkbenchFixture(prisma, { workspaceId: workspace.id, projectId: project.id, actorId: user.userId }, domain, 1_200, true); }
  finally { await prisma.$disconnect(); }
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base }, { name: "seo_project", value: project.id, url: base }]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/app/rankings");
  await page.locator(".rankings-matrix tbody [data-keyword-id]").first().waitFor();
  const geometry = await page.locator(".rankings-matrix tbody [data-keyword-id]").first().evaluate(row => {
    const label = row.querySelector(".rankings-query-text > strong"), info = row.querySelector(".info-tooltip-floating-trigger"), svg = info.querySelector("svg");
    return { height: row.getBoundingClientRect().height, weight: getComputedStyle(label).fontWeight, textSize: parseFloat(getComputedStyle(label).fontSize),
      infoHeight: info.getBoundingClientRect().height, svgHeight: svg.getBoundingClientRect().height };
  });
  assert.ok(geometry.height <= 46, JSON.stringify(geometry));
  assert.equal(geometry.weight, "550");
  assert.ok(geometry.textSize >= 13);
  assert.equal(geometry.infoHeight, 24);
  assert.equal(geometry.svgHeight, 13);
  const contrast = await page.locator(".rankings-query-text > strong").first().evaluate(element => {
    const color = value => value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    const luminance = values => values.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; })
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    let parent = element;
    while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)") parent = parent.parentElement;
    const foreground = luminance(color(getComputedStyle(element).color)), background = luminance(color(getComputedStyle(parent).backgroundColor));
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  assert.ok(contrast >= 4.5, "actual keyword foreground/background contrast meets the ordinary-text threshold");
  const information = page.locator(".rankings-matrix .info-tooltip-floating-trigger").first();
  await information.focus();
  const focusVisible = await information.evaluate(element => getComputedStyle(element).outlineStyle !== "none" && parseFloat(getComputedStyle(element).outlineWidth) >= 2);
  assert.ok(focusVisible, "keyboard focus stays visible");
  await page.getByRole("tooltip").waitFor();
  const popup = await page.getByRole("tooltip").boundingBox();
  assert.ok(popup.x >= 0 && popup.x + popup.width <= 1440 && popup.y >= 0 && popup.y + popup.height <= 1000);
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => document.activeElement?.closest("[data-keyword-id]")?.getAttribute("aria-rowindex") === "3");
  for (let index = 0; index < 50; index++) {
    await page.locator(".rankings-table-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(200);
    if (await page.locator(".rankings-matrix tbody .rankings-number-column").last().textContent() === "1200") break;
  }
  await page.waitForFunction(() => Number(document.querySelector(".rankings-number-column")?.closest("table")?.getAttribute("aria-rowcount")) === 1201);
  assert.ok(await page.locator(".rankings-matrix tbody [data-keyword-id]").count() < 80, "DOM stays bounded for 1,200 imported keywords");
  await page.locator(".rankings-table-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => [...document.querySelectorAll(".rankings-number-column")].some(element => element.textContent === "1200"));
  const lastRowBeforeOffline = await page.locator(".rankings-matrix tbody [data-keyword-id]").last().getAttribute("data-keyword-id");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await page.locator(".rankings-table-panel .inline-alert[role=alert]").waitFor();
  assert.equal(await page.locator(".rankings-matrix tbody [data-keyword-id]").last().getAttribute("data-keyword-id"), lastRowBeforeOffline, "failed refresh retains the loaded data, independently of DOM-window height");
  assert.equal(await page.locator(".rankings-matrix tbody .rankings-number-column").last().textContent(), "1200");
  await context.setOffline(false);
  await page.locator(".rankings-columns-toggle > summary").click();
  const dates = page.locator(".rankings-columns-toggle > div");
  await dates.waitFor();
  assert.equal(await dates.locator("input:not([type=checkbox]),select,button").count(), 0, "the date picker has no width/density settings");
  const date = dates.locator("input[type=checkbox]").first();
  const hiddenDateLabel = await date.getAttribute("aria-label");
  await date.uncheck();
  await page.keyboard.press("Escape");
  await dates.waitFor({ state: "hidden" });
  await page.reload();
  await page.locator(".rankings-matrix tbody [data-keyword-id]").first().waitFor();
  const reloadedHeight = await page.locator(".rankings-matrix tbody [data-keyword-id]").first().evaluate(row => row.getBoundingClientRect().height);
  assert.equal(reloadedHeight, 44);
  await page.locator(".rankings-columns-toggle > summary").click();
  assert.equal(await page.getByRole("checkbox", { name: hiddenDateLabel, exact: true }).isChecked(), false, "hidden dates survive reload");
  await page.keyboard.press("Escape");
  await page.goto(base + "/app/semantics");
  const expansion = page.locator(".semantic-group-expand-all");
  await expansion.waitFor();
  await page.waitForFunction(() => !document.querySelector(".semantic-group-expand-all")?.disabled);
  const icon = await expansion.evaluate(button => {
    const box = button.getBoundingClientRect(), svg = button.querySelector("svg").getBoundingClientRect();
    return { width: svg.width, height: svg.height, dx: Math.abs(box.x + box.width / 2 - svg.x - svg.width / 2), dy: Math.abs(box.y + box.height / 2 - svg.y - svg.height / 2) };
  });
  assert.equal(icon.width, 16); assert.equal(icon.height, 16); assert.ok(icon.dx <= 1 && icon.dy <= 1);
  const plus = await page.getByRole("button", { name: "Создать корневую группу", exact: true }).evaluate(button => {
    const box = button.getBoundingClientRect(), svg = button.querySelector("svg").getBoundingClientRect();
    return { width: svg.width, height: svg.height, dx: Math.abs(box.x + box.width / 2 - svg.x - svg.width / 2), dy: Math.abs(box.y + box.height / 2 - svg.y - svg.height / 2) };
  });
  assert.equal(plus.width, 16); assert.equal(plus.height, 16); assert.ok(plus.dx <= 1 && plus.dy <= 1);
  await page.locator(".semantic-query-text").first().waitFor();
  const semanticQuerySize = await page.locator(".semantic-query-text").first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  assert.equal(semanticQuerySize, 10, "semantic queries keep their original font size");
  if ((await expansion.getAttribute("aria-label"))?.includes("Свернуть")) await expansion.click();
  await expansion.click();
  assert.ok(await page.locator(".semantic-group-tree-list .semantic-group-name").count() < 100, "large folder tree also keeps a bounded DOM");
  await page.locator(".semantic-group-tree-list .semantic-group-name").first().focus();
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.textContent.includes("Группа 1200"));
  await page.screenshot({ path: output + "/regression-semantic-icons.png" });
  assert.deepEqual(errors, []);
  await writeFile(output + "/usability-regression-result.json", JSON.stringify({ importedKeywords: 1200, importedGroups: 1201, geometry, reloadedHeight, icon, plus, semanticQuerySize }), { mode: 0o600 });
});
