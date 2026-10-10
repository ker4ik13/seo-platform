import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { chromium, request } from "playwright";

test(
  "real activity and import facts reach the protected analytics UI with finance isolation",
  {
    skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
    timeout: 180_000,
  },
  async (t) => {
    const base = process.env.SEO_PLATFORM_PUBLIC_URL;
    assert.ok(base?.startsWith("https://"));
    const fixtures = JSON.parse(
        await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"),
      ),
      [user, analyst, superAdmin, other] = fixtures;
    const api = await request.newContext({
        baseURL: base,
        storageState: user.storageState,
      }),
      analystApi = await request.newContext({
        baseURL: base,
        storageState: analyst.storageState,
      }),
      superApi = await request.newContext({
        baseURL: base,
        storageState: superAdmin.storageState,
      }),
      otherApi = await request.newContext({
        baseURL: base,
        storageState: other.storageState,
      });
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await Promise.all(
        [api, analystApi, superApi, otherApi].map((client) => client.dispose()),
      );
    });
    const errors = [];
    async function call(client, method, endpoint, data, version) {
      const csrf = (await client.storageState()).cookies.find(
        (cookie) => cookie.name === "seo_csrf",
      )?.value;
      const response = await client.fetch(`/app/api/${endpoint}`, {
        method,
        headers: {
          Origin: base,
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          ...(method !== "GET" ? { "Idempotency-Key": randomUUID() } : {}),
          ...(version === undefined ? {} : { "If-Match": `"v${version}"` }),
        },
        ...(data === undefined ? {} : { data }),
      });
      const body = await response.json();
      assert.ok(
        response.ok(),
        `${method} ${endpoint}: ${response.status()} ${body.error?.code ?? ""}`,
      );
      return body.data;
    }
    const workspace = await call(api, "POST", "workspaces", {
      name: "Analytics E2E",
      country: "RU",
      locale: "ru",
      timezone: "Europe/Berlin",
      billingCurrency: "RUB",
    });
    await call(api, "POST", `workspaces/${workspace.id}/billing/trial`);
    const project = await call(
      api,
      "POST",
      `workspaces/${workspace.id}/projects`,
      {
        name: "Analytics E2E",
        domain: "analytics.example.invalid",
        locale: "ru",
        timezone: "Europe/Berlin",
      },
    );
    const foreign = await call(otherApi, "POST", "workspaces", {
      name: "Foreign analytics",
      country: "RU",
      locale: "ru",
      timezone: "Europe/Berlin",
      billingCurrency: "RUB",
    });
    const phrase = `analytics keyword ${randomUUID().slice(0, 8)}`,
      bytes = Buffer.from(`Фраза;Частотность\n${phrase};33\n`, "utf8");
    const upload = await call(api, "POST", `projects/${project.id}/uploads`, {
      fileName: "analytics.csv",
      mediaType: "text/csv",
      sizeBytes: String(bytes.length),
    });
    const parts = await call(
      api,
      "POST",
      `projects/${project.id}/uploads/${upload.upload.id}/parts`,
      { partNumbers: [1] },
    );
    const csrf = (await api.storageState()).cookies.find(
      (cookie) => cookie.name === "seo_csrf",
    )?.value;
    const sent = await api.put("/app/api/storage-upload", {
      headers: {
        Origin: base,
        "Content-Type": "text/csv",
        "x-seo-storage-url": parts.parts[0].url,
      },
      data: bytes,
    });
    assert.equal(sent.status(), 204);
    await call(
      api,
      "POST",
      `projects/${project.id}/uploads/${upload.upload.id}/complete`,
      { parts: [{ partNumber: 1, etag: sent.headers().etag }] },
    );
    async function until(endpoint, status) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await call(api, "GET", endpoint);
        if (value.status === status) return value;
        assert.ok(!["FAILED", "REJECTED", "CANCELLED"].includes(value.status));
        await delay(500);
      }
      assert.fail(`${endpoint} did not reach ${status}`);
    }
    await until(`projects/${project.id}/uploads/${upload.upload.id}`, "READY");
    const imported = await call(api, "POST", `projects/${project.id}/imports`, {
      uploadId: upload.upload.id,
    });
    const parsed = await until(
      `projects/${project.id}/imports/${imported.id}`,
      "AWAITING_MAPPING",
    );
    const text = parsed.preview.columns.find(
        (row) => row.sourceName === "Фраза",
      ),
      frequency = parsed.preview.columns.find(
        (row) => row.sourceName === "Частотность",
      );
    assert.ok(text && frequency);
    await call(
      api,
      "POST",
      `projects/${project.id}/imports/${imported.id}/mapping`,
      {
        columns: [
          { sourceIndex: text.index, target: "keyword.text" },
          { sourceIndex: frequency.index, target: "frequency.base" },
        ],
        defaultLanguage: "ru",
        groupSeparator: "/",
        duplicatePolicy: "MERGE_NON_EMPTY",
        createMissingKeywords: true,
      },
      parsed.version,
    );
    const validated = await until(
      `projects/${project.id}/imports/${imported.id}`,
      "AWAITING_CONFIRMATION",
    );
    await call(
      api,
      "POST",
      `projects/${project.id}/imports/${imported.id}/publish`,
      undefined,
      validated.version,
    );
    await until(`projects/${project.id}/imports/${imported.id}`, "COMPLETED");
    const keywords = await call(
      api,
      "GET",
      `projects/${project.id}/keywords?limit=100`,
    );
    assert.equal(keywords.length, 1);
    const context = await browser.newContext({
      storageState: await api.storageState(),
      viewport: { width: 1440, height: 900 },
    });
    await context.addCookies([
      { name: "seo_workspace", value: workspace.id, url: base },
      { name: "seo_project", value: project.id, url: base },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/app/semantics`);
    await page.bringToFront();
    await page
      .locator(`tr[data-presence-key="keyword:${keywords[0].id}"]`)
      .click();
    await page.locator(".semantic-keyword-inspector").waitFor();
    await page.mouse.move(700, 450);
    await delay(12000);
    const flushed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/analytics/activity") &&
        response.status() === 202,
    );
    await page.locator(".sidebar a[data-presence-key='nav:overview']").click();
    const activityResponse = await flushed;
    const body = activityResponse.request().postDataJSON();
    assert.equal(JSON.stringify(body).includes(phrase), false);
    assert.equal(body.userId, undefined);
    assert.ok((await activityResponse.json()).data.accepted > 0);
    const sample = {
      version: 1,
      sessionId: randomUUID(),
      workspaceId: foreign.id,
      intervals: [],
      events: [
        {
          id: randomUUID(),
          occurredAt: new Date().toISOString(),
          section: "OTHER",
          kind: "PAGE_VIEW",
          count: 1,
          value: 0,
        },
      ],
    };
    assert.ok(
      [403, 404].includes(
        (
          await api.post("/app/api/analytics/activity", {
            headers: { Origin: base, "X-CSRF-Token": csrf },
            data: sample,
          })
        ).status(),
      ),
    );
    assert.equal(
      (
        await api.get("/admin/api/analytics?days=7&includeInternal=true")
      ).status(),
      403,
    );
    const analystResponse = await analystApi.get(
      "/admin/api/analytics?days=7&includeInternal=true",
    );
    assert.equal(analystResponse.status(), 200);
    const report = (await analystResponse.json()).data;
    assert.equal(report.finance, undefined);
    assert.ok(report.audience.current.users >= 1);
    assert.ok(report.audience.current.seconds >= 5);
    assert.ok(
      report.features.find((row) => row.section === "SEMANTICS")?.results >= 1,
    );
    assert.ok(
      report.operations.types.find((row) => row.key === "SEMANTIC_IMPORT")
        ?.completed >= 1,
    );
    const repeats = await Promise.all(
      Array.from({ length: 6 }, () =>
        analystApi
          .get("/admin/api/analytics?days=7&includeInternal=true")
          .then((response) => response.json()),
      ),
    );
    assert.ok(
      repeats.every((row) => row.data.generatedAt === report.generatedAt),
      "refreshes must reuse the cached report",
    );
    const financeReport = await superApi.get(
      "/admin/api/analytics?days=7&includeInternal=true",
    );
    assert.equal(financeReport.status(), 200);
    assert.ok((await financeReport.json()).data.finance);
    const analystContext = await browser.newContext({
        storageState: await analystApi.storageState(),
        viewport: { width: 1440, height: 900 },
      }),
      adminPage = await analystContext.newPage();
    adminPage.on("pageerror", (error) => errors.push(error.message));
    await adminPage.goto(
      `${base}/admin?screen=analytics&analyticsDays=7&analyticsInternal=true`,
    );
    await adminPage
      .getByRole("button", { name: "Аудитория", exact: true })
      .waitFor();
    await adminPage.screenshot({
      path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/analytics-audience.png`,
      fullPage: true,
    });
    assert.equal(
      await adminPage
        .getByRole("button", { name: "Финансы", exact: true })
        .count(),
      0,
    );
    await adminPage
      .getByRole("button", { name: "Операции", exact: true })
      .click();
    await adminPage
      .getByRole("heading", { name: "Скорость и результат по операциям" })
      .waitFor();
    await adminPage
      .locator(".analytics-table-scroll")
      .getByText("Импорт", { exact: true })
      .waitFor();
    await adminPage
      .getByRole("button", { name: "Активация и удержание", exact: true })
      .click();
    await adminPage
      .getByRole("heading", { name: "Недельные когорты удержания" })
      .waitFor();
    await adminPage
      .getByRole("button", { name: "Функции и время", exact: true })
      .click();
    await adminPage
      .getByRole("heading", { name: "Использование функций" })
      .waitFor();
    await adminPage.screenshot({
      path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/product-analytics.png`,
      fullPage: true,
    });
    await adminPage
      .getByRole("button", { name: "Качество", exact: true })
      .click();
    await adminPage
      .getByRole("heading", { name: "Ошибки интерфейса по дням", exact: true })
      .waitFor();
    await adminPage.screenshot({
      path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/analytics-quality.png`,
      fullPage: true,
    });
    const downloaded = adminPage.waitForEvent("download");
    await adminPage
      .getByRole("button", { name: "Скачать CSV", exact: true })
      .click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), "analytics-7d.csv");
    assert.ok(
      (await readFile(await download.path(), "utf8")).startsWith(
        "\uFEFFdate_utc;users;",
      ),
    );
    await adminPage.reload();
    assert.equal(
      await adminPage.locator(".analytics-internal input").isChecked(),
      true,
    );
    const superContext = await browser.newContext({
      storageState: await superApi.storageState(),
      viewport: { width: 1440, height: 900 },
    });
    const financePage = await superContext.newPage();
    financePage.on("pageerror", (error) => errors.push(error.message));
    await financePage.goto(
      `${base}/admin?screen=analytics&analyticsDays=7&analyticsInternal=true&analyticsTab=finance`,
    );
    await financePage
      .getByRole("button", { name: "Финансы", exact: true })
      .click();
    await financePage
      .getByRole("heading", { name: "Оплаты и возвраты, ₽", exact: true })
      .waitFor();
    await financePage.screenshot({
      path: `${process.env.SEO_PLATFORM_E2E_OUTPUT_DIR}/analytics-finance.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  },
);
