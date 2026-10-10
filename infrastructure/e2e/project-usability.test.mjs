import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import test from "node:test";
import { chromium, request } from "playwright";
import { PrismaService } from "../../backend-core/modules/seo/dist/database/prisma.service.js";
import { loadAppConfig } from "../../backend-core/modules/seo/dist/config/app-config.js";
import { createRankWorkbenchFixture } from "../../backend-core/modules/seo/dist/rank-workbench/rank-workbench.fixtures.js";

test(
  "real HTTPS project forms, folder expansion, URL filters, ordinal widths and calendar sessions",
  {
    skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
    timeout: 300_000,
  },
  async (t) => {
    const base = process.env.SEO_PLATFORM_PUBLIC_URL,
      output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
    assert.ok(base?.startsWith("https://144.31.221.28:3000"));
    const fixtures = JSON.parse(
        await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"),
      ),
      [user] = fixtures;
    const api = await request.newContext({
      baseURL: base,
      storageState: user.storageState,
    });
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await api.dispose();
    });
    async function call(method, path, data, version) {
      const cookies = (await api.storageState()).cookies,
        csrf = cookies.find((cookie) => cookie.name === "seo_csrf")?.value;
      const response = await api.fetch("/app/api/" + path, {
        method,
        headers: {
          Origin: base,
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          ...(method === "GET" ? {} : { "Idempotency-Key": randomUUID() }),
          ...(version === undefined
            ? {}
            : { "If-Match": '"v' + version + '"' }),
        },
        ...(data === undefined ? {} : { data }),
      });
      const body = await response.json();
      assert.ok(
        response.ok(),
        method +
          " " +
          path +
          ": " +
          response.status() +
          " " +
          (body.error?.code ?? ""),
      );
      return body.data;
    }
    const workspace = await call("POST", "workspaces", {
      name: "Аудит интерфейса",
      country: "RU",
      locale: "ru",
      timezone: "Europe/Moscow",
      billingCurrency: "RUB",
    });
    const domain = "ui-" + randomUUID().slice(0, 8) + ".example.invalid";
    const project = await call("POST", `workspaces/${workspace.id}/projects`, {
      name: "Проверка интерфейса",
      domain,
      locale: "ru",
      timezone: "Europe/Moscow",
    });
    const env = parseEnv(
      await readFile(
        "/home/dev/.local/share/seo-platform-runtime/runtime.env",
        "utf8",
      ),
    );
    const prisma = new PrismaService(
      loadAppConfig({
        ...env,
        NODE_ENV: "test",
        DATABASE_URL: `postgresql://seo_owner:${encodeURIComponent(env.SEO_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/seo_db`,
      }),
    );
    let data;
    try {
      data = await createRankWorkbenchFixture(
        prisma,
        {
          workspaceId: workspace.id,
          projectId: project.id,
          actorId: user.userId,
        },
        domain,
      );
    } finally {
      await prisma.$disconnect();
    }
    const context = await browser.newContext({
      storageState: await api.storageState(),
      viewport: { width: 1440, height: 1000 },
    });
    await context.addCookies([
      { name: "seo_workspace", value: workspace.id, url: base },
      { name: "seo_project", value: project.id, url: base },
    ]);
    const page = await context.newPage(),
      pageErrors = [],
      responseErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 500 &&
        new URL(response.url()).pathname.startsWith("/app/api/")
      )
        responseErrors.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    await page.goto(base + "/app/projects?create=1");
    const creation = page.getByRole("dialog", {
      name: "Новый проект",
      exact: true,
    });
    await creation.waitFor();
    const aligned = await creation.evaluate((dialog) => {
      const fields = [
        ...dialog.querySelectorAll(".project-setup-fields input"),
      ].map((field) => {
        const r = field.getBoundingClientRect();
        return { top: r.top, height: r.height };
      });
      return fields;
    });
    assert.equal(aligned.length, 2);
    assert.ok(
      Math.abs(aligned[0].top - aligned[1].top) < 1 &&
        Math.abs(aligned[0].height - aligned[1].height) < 1,
      "hints must not stretch or offset adjacent fields",
    );
    await page.screenshot({
      path: output + "/aligned-project-form.png",
      fullPage: true,
    });
    await creation
      .getByRole("button", { name: "Закрыть окно", exact: true })
      .click();
    await page.goto(base + "/app/semantics");
    await page
      .locator(".semantic-table tbody tr[data-presence-key]")
      .first()
      .waitFor();
    const expand = page.getByRole("button", {
      name: "Раскрыть все папки",
      exact: true,
    });
    if (await expand.count()) await expand.click();
    const full = await page
      .locator(".semantic-group-tree .semantic-group-name")
      .count();
    assert.ok(full >= 5);
    await page
      .getByRole("button", { name: "Свернуть все папки", exact: true })
      .click();
    const collapsed = await page
      .locator(".semantic-group-tree .semantic-group-name")
      .count();
    assert.ok(
      collapsed < full,
      "collapse must remove descendants from the visible tree",
    );
    await expand.click();
    assert.equal(
      await page.locator(".semantic-group-tree .semantic-group-name").count(),
      full,
    );
  await page.locator(".semantic-filter-disclosure > summary").click();
    await page
      .getByRole("combobox", {
        name: "Несколько страниц сайта в выдаче",
        exact: true,
      })
      .click();
    await page
      .getByRole("option", { name: "Несколько URL", exact: true })
      .click();
    const filterRequest = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/keywords/list") &&
        response.request().postDataJSON()?.query?.multipleUrlsState ===
          "MULTIPLE",
    );
    await page
      .locator(".semantic-filter-popover-actions")
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    const filtered = await filterRequest;
    assert.equal(filtered.status(), 200);
    const filteredRows = (await filtered.json()).data;
    assert.equal(filteredRows.length, 3);
    await page.screenshot({
      path: output + "/semantic-url-filter.png",
      fullPage: true,
    });
    await page.goto(base + "/app/rankings");
    await page.locator(".rankings-matrix tbody tr").first().waitFor();
    await page
      .locator(".rankings-filter-primary .custom-select-trigger")
      .first()
      .click();
    await page
      .getByRole("option")
      .filter({ has: page.locator(".search-engine-logo.yandex") })
      .filter({ hasText: "Москва" })
      .click();
    await page.locator(".rankings-matrix tbody tr").first().waitFor();
    const numberHandle = page.getByRole("separator", {
      name: "Изменить ширину колонки №",
      exact: true,
    });
    const initialWidth = Number(
      await numberHandle.getAttribute("aria-valuenow"),
    );
    await numberHandle.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      Number(await numberHandle.getAttribute("aria-valuenow")),
      initialWidth + 16,
    );
    await page.reload();
    await page.locator(".rankings-matrix tbody tr").first().waitFor();
    assert.equal(
      Number(await numberHandle.getAttribute("aria-valuenow")),
      initialWidth + 16,
      "column width must survive reload",
    );
    assert.equal(
      (
        await page.locator(".rankings-number-column").nth(1).textContent()
      ).trim(),
      "1",
    );
    await page.locator(".rankings-table-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".rankings-matrix tbody tr").length >= 200,
    );
    const ordinal = await page
      .locator(".rankings-matrix tbody tr td.rankings-number-column")
      .allTextContents();
    assert.deepEqual(
      ordinal.map((text) => Number(text.trim())),
      Array.from({ length: ordinal.length }, (_, index) => index + 1),
    );
    await page.locator(".rankings-table-scroll").evaluate((element) => {
      element.scrollTop = 0;
    });
    let apiReads = 0;
    const onRequest = (req) => {
      if (new URL(req.url()).pathname.startsWith("/app/api/")) apiReads++;
    };
    page.on("request", onRequest);
    await page
      .getByRole("button", {
        name: "Быстрая информация о запросе",
        exact: true,
      })
      .first()
      .hover();
    await page.getByRole("tooltip").waitFor();
    assert.ok(
      (await page.getByRole("tooltip").textContent()).includes("Найденный URL"),
    );
    assert.equal(apiReads, 0, "hover must not issue any per-row API queries");
    page.off("request", onRequest);
    await page.keyboard.press("Escape");
    const first = data.keywords.find(
      (keyword) => keyword.textOriginal === data.texts[0],
    );
    assert.ok(first);
    const firstRow = page.locator(`tr[data-keyword-id="${first.id}"]`);
    await firstRow
      .getByRole("button", { name: "Сезонность запроса", exact: true })
      .click();
    const seasonality = page.getByRole("dialog", {
      name: "Сезонность",
      exact: true,
    });
    await seasonality.locator(".semantic-seasonality-chart").waitFor();
    await page.screenshot({
      path: output + "/rankings-seasonality.png",
      fullPage: true,
    });
    await seasonality
      .getByRole("button", { name: "Закрыть окно", exact: true })
      .click();
    await page
      .getByRole("combobox", {
        name: "Несколько страниц сайта в выдаче",
        exact: true,
      })
      .click();
    await page
      .getByRole("option", { name: "Несколько URL", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".rankings-matrix tbody tr").length === 2,
    );
    const multipleQueries = await page
      .locator(".rankings-query-text > strong")
      .allTextContents();
    assert.deepEqual(
      multipleQueries.sort(),
      [data.texts[0], data.texts[4]].sort(),
    );
    await page.screenshot({
      path: output + "/rankings-url-filter.png",
      fullPage: true,
    });
    const calendarTrigger = page.locator(
      ".rankings-date-filter .dashboard-date-range-trigger",
    );
    await calendarTrigger.click();
    const calendar = page.getByRole("dialog", {
      name: "Выбрать период позиций",
      exact: true,
    });
    const currentFrom = await calendar
      .locator('[data-date-bound="from"] time')
      .getAttribute("datetime");
    const today = await page.evaluate(() =>
      [
        new Date().getFullYear(),
        String(new Date().getMonth() + 1).padStart(2, "0"),
        String(new Date().getDate()).padStart(2, "0"),
      ].join("-"),
    );
    assert.equal(
      await calendar
        .locator('[data-date-bound="to"] time')
        .getAttribute("datetime"),
      today,
    );
    const yesterday = data.latest.slice(0, 10);
    await calendar.locator(`button[data-date-key="${currentFrom}"]`).click();
    await calendar.locator(`button[data-date-key="${yesterday}"]`).click();
    await calendar
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await calendarTrigger.click();
    assert.equal(
      await calendar
        .locator('[data-date-bound="from"] time')
        .getAttribute("datetime"),
      currentFrom,
    );
    assert.equal(
      await calendar
        .locator('[data-date-bound="to"] time')
        .getAttribute("datetime"),
      yesterday,
    );
    await calendar
      .getByRole("button", { name: "Закрыть выбор периода", exact: true })
      .click();
    await page.reload();
    await page.locator(".rankings-matrix tbody tr").first().waitFor();
    await calendarTrigger.click();
    assert.equal(
      await calendar
        .locator('[data-date-bound="to"] time')
        .getAttribute("datetime"),
      yesterday,
      "manual end must survive a page reload",
    );
    await calendar
      .locator(".date-range-today")
      .click();
    assert.equal(
      await calendar
        .locator('[data-date-bound="from"] time')
        .getAttribute("datetime"),
      currentFrom,
      "Today must change only the end",
    );
    await calendar
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "mobile filters must not widen the document",
    );
    await page.screenshot({
      path: output + "/rankings-mobile.png",
      fullPage: true,
    });

    // Real modal and calendar: no response/SQL substitution and no export command.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + "/app/semantics");
    await page.locator(".semantic-query-text").first().waitFor();
    await page.getByRole("button", { name: "Экспорт", exact: true }).click();
    const exportModal = page.getByRole("dialog", { name: "Экспорт семантики", exact: true });
    await exportModal.getByRole("combobox", { name: "Содержимое файла", exact: true }).click();
    await page.getByRole("option", { name: "История позиций по датам", exact: true }).click();
    const exportTrigger = exportModal.locator(".dashboard-date-range-trigger");
    const exportCalendar = page.getByRole("dialog", { name: "Выбрать период экспорта", exact: true });
    const calendarGeometry = [];
    for (const [width, height] of [[1440, 1000], [1440, 780], [768, 900], [390, 844], [320, 700]]) {
      await page.setViewportSize({ width, height });
      await exportTrigger.scrollIntoViewIfNeeded();
      const body = exportModal.locator(".semantic-modal-body");
      const before = await body.evaluate(element => ({ height: element.scrollHeight, top: element.scrollTop }));
      await exportTrigger.click();
      await exportCalendar.waitFor();
      const box = await exportCalendar.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
        `export calendar stays in viewport ${width}x${height}: ${JSON.stringify(box)}`);
      assert.deepEqual(await body.evaluate(element => ({ height: element.scrollHeight, top: element.scrollTop })), before,
        "opening a calendar must not expand or scroll the modal body");
      assert.equal(await exportCalendar.evaluate(element => element.parentElement.parentElement.matches("dialog.semantic-export-modal")), true,
        "calendar is portalled outside the scroll body but stays in the native dialog top layer");
      const day = exportCalendar.locator(".dashboard-calendar-days button:not(:disabled)").last();
      await day.scrollIntoViewIfNeeded();
      assert.ok(await day.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }),
        "calendar is not obscured by the export modal");
      if (width >= 768) {
        const values = await exportCalendar.evaluate(element => {
          const from = element.querySelector('[data-date-bound="from"]').getBoundingClientRect();
          const to = element.querySelector('[data-date-bound="to"]').getBoundingClientRect();
          const date = element.querySelector('[data-date-bound="to"] time').getBoundingClientRect();
          const today = element.querySelector(".date-range-today").getBoundingClientRect();
          return { from: from.height, to: to.height, dy: Math.abs(date.y + date.height / 2 - today.y - today.height / 2) };
        });
        assert.equal(values.from, values.to);
        assert.ok(values.dy < 1, `Today must be centered: ${JSON.stringify(values)}`);
      }
      calendarGeometry.push({ width, height, box });
      await page.screenshot({ path: output + `/export-calendar-${width}-${height}.png` });
      await page.keyboard.press("Escape");
      await exportCalendar.waitFor({ state: "hidden" });
      assert.equal(await exportModal.isVisible(), true, "Escape closes only the calendar");
    }
    await exportModal.getByRole("button", { name: "Закрыть окно", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + `/app/projects/${project.id}/tools/serp`);
    const highlights = page.locator(".serp-highlight-settings");
    await highlights.waitFor();
    await highlights.getByRole("textbox", { name: "Добавить домен", exact: true }).fill("competitor.example.invalid");
    await highlights.getByRole("button", { name: "Добавить домен", exact: true }).click();
    const chip = highlights.locator(".serp-domain-chips button").filter({ hasText: "competitor.example.invalid" });
    await chip.waitFor();
    const highlightGeometry = await highlights.evaluate(element => {
      const input = element.querySelector("form input").getBoundingClientRect(), button = element.querySelector("form button").getBoundingClientRect();
      return { height: element.getBoundingClientRect().height, dy: Math.abs(input.y + input.height / 2 - button.y - button.height / 2), inputHeight: input.height, buttonHeight: button.height };
    });
    assert.ok(highlightGeometry.height <= 52 && highlightGeometry.dy < 1, JSON.stringify(highlightGeometry));
    assert.equal(highlightGeometry.inputHeight, highlightGeometry.buttonHeight);
    await page.screenshot({ path: output + "/compact-serp-domains.png" });
    await page.setViewportSize({ width: 320, height: 700 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "domain controls wrap without widening the page");
    await chip.click();
    await chip.waitFor({ state: "hidden" });
    await writeFile(output + "/calendar-domain-layout.json", JSON.stringify({ calendarGeometry, highlightGeometry }), { mode: 0o600 });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(responseErrors, []);
  await writeFile(
    output + "/usability-project.json",
      JSON.stringify({
        workspaceId: workspace.id,
        projectId: project.id,
        domain,
        fixtureCount: data.count,
        userId: user.userId,
      }),
    { mode: 0o600 },
  );
  await writeFile(output + "/usability-owner.json", JSON.stringify(await context.storageState()), { mode: 0o600 });
  },
);
