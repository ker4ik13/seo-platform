import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium, request } from "playwright";

const base = process.env.SEO_PLATFORM_PUBLIC_URL;
const output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;

test("semantic controls: exact column drag, wide project selector and tag deletion", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
  timeout: 180_000
}, async (t) => {
  assert.ok(base?.startsWith("https://"));
  assert.ok(output?.startsWith("/"));
  assert.ok(process.env.SEO_PLATFORM_SESSION_FIXTURES);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const [fixture] = JSON.parse(
    await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8")
  );
  const api = await request.newContext({
    baseURL: base,
    storageState: fixture.storageState
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await api.dispose();
  });

  async function command(method, endpoint, data) {
    const csrf = (await api.storageState()).cookies.find(
      (cookie) => cookie.name === "seo_csrf"
    )?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, {
      method,
      headers: {
        Origin: base,
        "Idempotency-Key": randomUUID(),
        ...(csrf ? { "X-CSRF-Token": csrf } : {})
      },
      ...(data === undefined ? {} : { data })
    });
    const body = await response.json();
    assert.ok(
      response.ok(),
      `${method} ${endpoint}: ${response.status()} ${body.error?.code ?? ""}`
    );
    return body.data;
  }

  await command("PATCH", "me/preferences", { locale: "ru" });
  const workspace = await command("POST", "workspaces", {
    name: "Semantic controls",
    country: "RU",
    locale: "ru",
    timezone: "Europe/Berlin",
    billingCurrency: "RUB"
  });
  await command("POST", `workspaces/${workspace.id}/billing/trial`);
  const project = await command("POST", `workspaces/${workspace.id}/projects`, {
    name: "Основной длинный проект",
    domain: "example.com",
    locale: "ru",
    timezone: "Europe/Berlin"
  });
  await command("POST", `workspaces/${workspace.id}/projects`, {
    name: "Второй проект для переноса",
    domain: "example.org",
    locale: "ru",
    timezone: "Europe/Berlin"
  });
  await command("POST", `projects/${project.id}/keywords/bulk`, {
    items: ["первый запрос", "второй запрос", "третий запрос"].map((text) => ({
      text,
      language: "ru",
      priority: 0,
      isFavorite: false,
      isTracked: true,
      tagNames: ["Удаляемый тег"]
    })),
    duplicatePolicy: "SKIP_EXISTING"
  });
  const trackingContext = await command(
    "POST",
    `projects/${project.id}/tracking-contexts`,
    {
      name: "Москва · Десктоп",
      configuration: {
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP",
        depth: 50,
        domainMatchRule: { mode: "INCLUDE_WWW" },
        safeSearch: false
      },
      launchProfile: {
        searchSource: "LIVE",
        yandexLiveMode: "TURBO",
        xmlStockDepthMode: "STRICT_DEPTH",
        includeUntracked: false,
        scope: { mode: "ALL", groupIds: [], descendantGroupIds: [] }
      }
    }
  );
  assert.equal(trackingContext.launchProfile.yandexLiveMode, "TURBO");
  assert.equal(trackingContext.launchProfile.xmlStockDepthMode, "STRICT_DEPTH");

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 950 }
  });
  await context.addCookies([
    { name: "seo_workspace", value: workspace.id, url: base },
    { name: "seo_project", value: project.id, url: base },
    { name: "seo_ui_locale", value: "ru", url: base }
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });
  await page.locator(".semantic-table tbody tr[data-presence-row-id]").first().waitFor();

  const header = page.locator(".semantic-core-header");
  assert.equal(await header.getByText("Загружено", { exact: true }).count(), 0);
  const projectSelect = header.locator(".semantic-title-block [role=combobox]");
  const triggerBounds = await projectSelect.boundingBox();
  assert.ok(triggerBounds && triggerBounds.width >= 190);
  await projectSelect.click();
  const projectPopover = page.locator(".project-select-popover");
  const popoverBounds = await projectPopover.boundingBox();
  assert.ok(popoverBounds && popoverBounds.width >= 300);
  assert.equal(await projectPopover.locator("svg.lucide-grip-vertical").count(), 2);
  assert.doesNotMatch(await projectPopover.innerText(), /⋮/u);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Колонки и представления", exact: true }).click();
  const drawer = page.locator(".semantic-layout-drawer");
  await drawer.waitFor();
  assert.equal(
    await drawer.locator(":scope > .semantic-sidebar-header").evaluate(
      (node) => getComputedStyle(node).borderBottomWidth
    ),
    "0px"
  );
  const rows = drawer.locator(".semantic-layout-column-group").last().locator(".semantic-layout-column-row");
  assert.ok(await rows.count() >= 4);
  const before = await rows.allTextContents();
  const source = rows.nth(0);
  const target = rows.nth(2);
  const sourceLabel = before[0];
  const targetLabel = before[2];
  assert.ok(sourceLabel && targetLabel);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  const targetBounds = await target.boundingBox();
  assert.ok(targetBounds);
  await target.dispatchEvent("dragover", {
    clientY: targetBounds.y + targetBounds.height - 1,
    dataTransfer: transfer
  });
  assert.equal(await drawer.locator(".semantic-layout-column-row.is-dragging").count(), 1);
  assert.equal(await target.evaluate((node) => node.classList.contains("drop-after")), true);
  await page.screenshot({ path: path.join(output, "semantic-column-drop-target.png") });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await source.dispatchEvent("dragend", { dataTransfer: transfer });
  const after = await rows.allTextContents();
  const expected = before.filter((label) => label !== sourceLabel);
  expected.splice(expected.indexOf(targetLabel) + 1, 0, sourceLabel);
  assert.deepEqual(after, expected);
  await drawer.getByRole("button", { name: "Применить", exact: true }).click();
  await drawer.getByRole("tab", { name: "Представление и плотность", exact: true }).click();
  const savedViews = drawer.locator(".semantic-saved-views.embedded");
  await savedViews.getByText("Личное", { exact: true }).first().waitFor();
  assert.equal(
    await savedViews.evaluate((node) => getComputedStyle(node).borderTopWidth),
    "0px"
  );
  const savedViewCount = savedViews.locator(":scope > header span");
  assert.equal(await savedViewCount.innerText(), "1");
  const countBounds = await savedViewCount.boundingBox();
  assert.ok(countBounds && Math.abs(countBounds.width - countBounds.height) < 0.5);
  await page.screenshot({ path: path.join(output, "semantic-personal-view.png") });
  await drawer.getByRole("button", { name: "Закрыть настройки таблицы", exact: true }).click();

  await page.locator(".semantic-query-text").first().click();
  const inspector = page.locator(".semantic-keyword-inspector");
  await inspector.waitFor();
  await inspector.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page.locator("dialog[open].semantic-bulk-editor-modal");
  await editor.waitFor();
  await editor.locator('.keyword-tag-picker [role="combobox"]').first().click();
  await page.getByRole("button", { name: "Удалить тег «Удаляемый тег»", exact: true }).click();
  const confirmation = page.locator("dialog[open]").last();
  await confirmation.getByText("3 связанных запросов", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "semantic-tag-delete-confirmation.png") });
  await confirmation.getByRole("button", { name: "Удалить тег", exact: true }).click();
  await confirmation.waitFor({ state: "hidden" });
  const tags = await command("GET", `projects/${project.id}/keywords/tags`);
  assert.equal(tags.some(({ name }) => name === "Удаляемый тег"), false);
  assert.deepEqual(errors, []);
});
