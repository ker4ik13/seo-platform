import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, request } from "playwright";
import { setTimeout as delay } from "node:timers/promises";

test(
  "real HTTPS onboarding persists project/contexts/view, preserves personal columns, and resumes a lost create response",
  {
    skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
    timeout: 240_000,
  },
  async (t) => {
    const base = process.env.SEO_PLATFORM_PUBLIC_URL;
    assert.ok(base?.startsWith("https://"));
    const fixtures = JSON.parse(
      await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"),
    );
    const [user] = fixtures;
    const api = await request.newContext({
      baseURL: base,
      storageState: user.storageState,
    });
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await api.dispose();
    });
    const errors = [];
    async function call(method, endpoint, data, version, key) {
      const cookies = (await api.storageState()).cookies;
      const csrf = cookies.find((cookie) => cookie.name === "seo_csrf")?.value;
      const response = await api.fetch("/app/api/" + endpoint, {
        method,
        headers: {
          Origin: base,
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          ...(method !== "GET"
            ? { "Idempotency-Key": key ?? randomUUID() }
            : {}),
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
          endpoint +
          ": " +
          response.status() +
          " " +
          (body.error?.code ?? ""),
      );
      return body.data;
    }
    const workspace = await call("POST", "workspaces", {
      name: "Onboarding E2E",
      country: "RU",
      locale: "ru",
      timezone: "Europe/Moscow",
      billingCurrency: "RUB",
    });
    const context = await browser.newContext({
      storageState: await api.storageState(),
      viewport: { width: 1440, height: 1000 },
    });
    await context.addCookies([
      { name: "seo_workspace", value: workspace.id, url: base },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/app/projects?create=1");
    const modal = page.getByRole("dialog", {
      name: "Новый проект",
      exact: true,
    });
    await modal.waitFor();
    const domain =
      "onboarding-" + randomUUID().slice(0, 8) + ".example.invalid";
    await modal
      .getByRole("textbox", { name: /Название проекта/ })
      .fill("Onboarding E2E");
    await modal.getByRole("textbox", { name: /Домен/ }).fill(domain);
    await modal
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await modal
      .getByRole("heading", {
        name: "Где будете отслеживать сайт?",
        exact: true,
      })
      .waitFor();
    await modal
      .getByRole("checkbox", { name: "Снимать позиции: Google", exact: true })
      .check();
    const google = modal.locator(".project-setup-engine").filter({
      has: page.getByRole("checkbox", {
        name: "Снимать позиции: Google",
        exact: true,
      }),
    });
    const yandex = modal.locator(".project-setup-engine").filter({
      has: page.getByRole("checkbox", {
        name: "Снимать позиции: Яндекс",
        exact: true,
      }),
    });
    await google
      .getByRole("combobox", { name: "Глубина: Google", exact: true })
      .click();
    await page.getByRole("option", { name: "Топ-100", exact: true }).click();
    await google
      .getByRole("combobox", { name: "Регион", exact: true })
      .first()
      .click();
    await page.getByPlaceholder("Регион", { exact: true }).fill("Казань");
    await page.getByRole("option", { name: /^Казань/u }).click();
    await yandex
      .getByRole("checkbox", { name: "Телефон", exact: true })
      .check();
    await modal
      .getByRole("switch", {
        name: "Отслеживать сайт в ИИ-ответах",
        exact: true,
      })
      .check();
    await modal
      .getByRole("checkbox", { name: "ИИ-ответы: Google", exact: true })
      .uncheck();
    assert.ok(
      await modal
        .getByRole("switch", {
          name: "Отслеживать сайт в ИИ-ответах",
          exact: true,
        })
        .evaluate((element) => element.getBoundingClientRect().width >= 32),
      "AI switch must not be reduced to ordinary checkbox geometry",
    );
    assert.equal(
      await modal
        .locator(".search-engine-logo.google svg path")
        .first()
        .count(),
      1,
    );
    await page.screenshot({
      path: process.env.SEO_PLATFORM_E2E_OUTPUT_DIR + "/onboarding-search.png",
      fullPage: true,
    });
    await modal
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await modal
      .getByRole("heading", {
        name: "Какие колонки нужны в семантике?",
        exact: true,
      })
      .waitFor();
    await modal
      .getByRole("button", { name: "Выше: Частотность · точная", exact: true })
      .click();
    await modal
      .getByText("URL, даты и другие колонки", { exact: true })
      .click();
    await modal
      .getByRole("checkbox", {
        name: "Найденный URL по каждому срезу",
        exact: true,
      })
      .check();
    await modal
      .getByRole("checkbox", {
        name: "Дата съёма по каждому срезу",
        exact: true,
      })
      .check();
    await modal.getByText("Предпросмотр таблицы", { exact: true }).click();
    const preview = modal.locator(".project-setup-preview-scroll");
    const previewHeadings = await preview
      .locator(".semantic-engine-header, .semantic-rank-column-header")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent.replace(/\s+/gu, " ").trim(),
          logos: [...element.querySelectorAll(".search-engine-logo")].map(
            (logo) => ({
              label: logo.getAttribute("aria-label"),
              svg: logo.innerHTML,
            }),
          ),
        })),
      );
    assert.ok(
      previewHeadings.length >= 10,
      "wide preview must actually contain many search-engine columns",
    );
    assert.ok(
      previewHeadings.every((heading) => heading.logos.length === 1),
      "all engine columns, including AI and frequency, must show the original logo",
    );
    async function assertContainedPreview() {
      const geometry = await modal.evaluate((dialog) => {
        const body = dialog.querySelector(".semantic-modal-body"),
          form = dialog.querySelector(".project-setup-body"),
          scroll = dialog.querySelector(".project-setup-preview-scroll");
        const header = dialog.querySelector(".semantic-modal-header"),
          footer = dialog.querySelector(".semantic-modal-footer");
        const box = (element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        };
        const before = [box(dialog), box(header), box(footer)];
        scroll.scrollLeft = scroll.scrollWidth;
        return {
          overflow: [dialog, body, form].map(
            (element) => element.scrollWidth - element.clientWidth,
          ),
          ownScroll: scroll.scrollLeft,
          before,
          after: [box(dialog), box(header), box(footer)],
          stepsCentered: [
            ...dialog.querySelectorAll(".project-setup-steps button"),
          ].every(
            (button) => getComputedStyle(button).justifyContent === "center",
          ),
        };
      });
      assert.ok(
        geometry.overflow.every((extra) => extra <= 1),
        "preview must not horizontally scroll the dialog, body or form: " +
          JSON.stringify(geometry.overflow),
      );
      assert.ok(
        geometry.ownScroll > 0,
        "only the table must scroll horizontally",
      );
      assert.deepEqual(
        geometry.after,
        geometry.before,
        "table scrolling must never displace the dialog, header or footer",
      );
      assert.ok(geometry.stepsCentered);
    }
    await assertContainedPreview();
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: process.env.SEO_PLATFORM_E2E_OUTPUT_DIR + "/onboarding-columns.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertContainedPreview();
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({
      path:
        process.env.SEO_PLATFORM_E2E_OUTPUT_DIR +
        "/onboarding-columns-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await modal
      .getByRole("button", { name: "Закрыть окно", exact: true })
      .click();
    const closeConfirmation = page.getByRole("dialog", {
      name: "Закрыть настройку?",
      exact: true,
    });
    await closeConfirmation.waitFor();
    const actions = await closeConfirmation
      .locator(".confirmation-actions")
      .evaluate((element) => {
        const buttons = [...element.querySelectorAll("button")].map(
          (button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, left: rect.left, right: rect.right };
          },
        );
        return { width: element.clientWidth, buttons };
      });
    assert.equal(actions.buttons.length, 2);
    assert.ok(
      Math.abs(actions.buttons[0].width - actions.buttons[1].width) < 1,
      "confirmation buttons must have equal width",
    );
    assert.ok(
      actions.buttons[1].left - actions.buttons[0].right >= 8,
      "confirmation buttons must not touch",
    );
    assert.ok(
      Math.abs(
        actions.buttons[0].width +
          actions.buttons[1].width +
          12 -
          actions.width,
      ) < 2,
      "buttons must fill the confirmation footer",
    );
    await page.screenshot({
      path:
        process.env.SEO_PLATFORM_E2E_OUTPUT_DIR +
        "/onboarding-confirmation.png",
      fullPage: true,
    });
    await closeConfirmation
      .getByRole("button", { name: "Сохранить и закрыть", exact: true })
      .click();
    await page.goto(base + "/app/projects");
    await page.reload();
    await page
      .getByRole("button", { name: "Новый проект", exact: true })
      .click();
    await modal
      .getByRole("heading", {
        name: "Какие колонки нужны в семантике?",
        exact: true,
      })
      .waitFor();
    await modal
      .getByText("URL, даты и другие колонки", { exact: true })
      .click();
    assert.equal(
      await modal
        .getByRole("checkbox", {
          name: "Дата съёма по каждому срезу",
          exact: true,
        })
        .isChecked(),
      true,
      "closing and reload must restore the draft",
    );
    for (const name of ["WS · количество слов", "Группа", "Теги", "Источник"]) {
      assert.equal(
        await modal.getByRole("checkbox", { name, exact: true }).isChecked(),
        false,
      );
    }
    const accepted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/projects") &&
        response.status() >= 200 &&
        response.status() < 300,
    );
    await modal
      .getByRole("button", { name: "Создать проект", exact: true })
      .click();
    const response = await accepted,
      created = (await response.json()).data;
    const posted = response.request().postDataJSON();
    assert.deepEqual(created.onboarding, posted.onboarding);
    const settings = await call(
      "GET",
      "projects/" + created.id + "/tracking-contexts",
    );
    assert.equal(settings.contexts.length, 3);
    assert.ok(
      settings.contexts.every((context) => context.assignedKeywordCount === 0),
    );
    assert.deepEqual(
      [
        ...new Set(
          settings.contexts
            .filter(
              (context) => context.configuration.searchEngine === "GOOGLE",
            )
            .map((context) => context.configuration.depth),
        ),
      ],
      [100],
    );
    const views = await call(
      "GET",
      "projects/" + created.id + "/semantic-saved-views",
    );
    assert.equal(views.filter((view) => view.name === "Основное").length, 1);
    assert.deepEqual(
      views.find((view) => view.name === "Основное").config.columns,
      created.onboarding.columns,
    );
    assert.equal(
      (await call("GET", "projects/" + created.id + "/rank-runs")).jobs.length,
      0,
    );
    await page
      .getByRole("button", { name: "Открыть семантику", exact: true })
      .click();
    await page.waitForURL((url) => url.pathname === "/app/semantics");
    await delay(1500);
    const personal = (
      await call("GET", "projects/" + created.id + "/semantic-saved-views")
    ).find((view) => view.name === "Личное");
    assert.ok(personal);
    assert.deepEqual(personal.config.columns, created.onboarding.columns);
    assert.equal(
      await page
        .getByText("Сервис данных временно недоступен. Повторите загрузку", {
          exact: true,
        })
        .count(),
      0,
    );
    const keyword = await call("POST", "projects/" + created.id + "/keywords", {
      text: "Проверочный запрос " + randomUUID().slice(0, 8),
      language: "ru",
      priority: 0,
      isFavorite: false,
      isTracked: true,
      tagNames: [],
    });
    await page.reload();
    await page
      .locator('tr[data-presence-key="keyword:' + keyword.id + '"]')
      .waitFor();
    const actualHeadings = await page
      .locator(
        ".semantic-table th .semantic-engine-header, .semantic-table th .semantic-rank-column-header",
      )
      .evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent.replace(/\s+/gu, " ").trim(),
          logos: [...element.querySelectorAll(".search-engine-logo")].map(
            (logo) => ({
              label: logo.getAttribute("aria-label"),
              svg: logo.innerHTML,
            }),
          ),
        })),
      );
    assert.deepEqual(
      actualHeadings,
      previewHeadings,
      "preview must use the exact same column labels and original logos as the persisted semantics table",
    );
    assert.ok(
      (await page.locator(".semantic-table th").allTextContents()).some(
        (text) => text.includes("Казань"),
      ),
    );
    await page.screenshot({
      path:
        process.env.SEO_PLATFORM_E2E_OUTPUT_DIR + "/onboarding-semantic.png",
      fullPage: true,
    });
    const reordered = {
      ...personal.config,
      columns: [...personal.config.columns],
    };
    const baseIndex = reordered.columns.indexOf("frequency"),
      exactIndex = reordered.columns.indexOf("frequencyFixed");
    [reordered.columns[baseIndex], reordered.columns[exactIndex]] = [
      reordered.columns[exactIndex],
      reordered.columns[baseIndex],
    ];
    reordered.columnOrder = [
      ...reordered.columns,
      ...personal.config.columnOrder.filter(
        (key) => !reordered.columns.includes(key),
      ),
    ];
    await call(
      "PATCH",
      "projects/" + created.id + "/semantic-saved-views/" + personal.id,
      { config: reordered },
      personal.version,
    );
    await page.reload();
    await delay(1000);
    const after = (
      await call("GET", "projects/" + created.id + "/semantic-saved-views")
    ).find((view) => view.id === personal.id);
    assert.deepEqual(
      after.config.columns,
      reordered.columns,
      "bootstrap must not overwrite personal layout after reload",
    );
    await page.goto(base + "/app/rankings");
    await page
      .getByRole("button", {
        name: /Снять позиции|Собрать позиции|Проверить позиции/,
      })
      .first()
      .click();
    const run = page.getByRole("dialog").filter({
      has: page.getByText("География и устройство", { exact: true }),
    });
    await run.waitFor();
    await delay(750);
    assert.equal(
      await run.getByRole("radio", { name: "Топ-30", exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await run
        .getByRole("checkbox", { name: "Телефон", exact: true })
        .isChecked(),
      true,
    );
    await run.getByRole("button", { name: /Закрыть окно/ }).click();

    const second = await call("POST", "workspaces", {
      name: "Onboarding retry E2E",
      country: "RU",
      locale: "ru",
      timezone: "Europe/Moscow",
      billingCurrency: "RUB",
    });
    await context.addCookies([
      { name: "seo_workspace", value: second.id, url: base },
    ]);
    await page.goto(base + "/app/projects?create=1");
    const retryModal = page.getByRole("dialog", {
      name: "Новый проект",
      exact: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await retryModal.waitFor();
    const mobileBounds = await retryModal.evaluate((element) => ({
      right: element.getBoundingClientRect().right,
      width: window.innerWidth,
    }));
    assert.ok(
      mobileBounds.right <= mobileBounds.width,
      "mobile dialog must fit the viewport",
    );
    await page.screenshot({
      path: process.env.SEO_PLATFORM_E2E_OUTPUT_DIR + "/onboarding-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await retryModal
      .getByRole("textbox", { name: /Название проекта/ })
      .fill("Lost response");
    await retryModal
      .getByRole("textbox", { name: /Домен/ })
      .fill("retry-" + randomUUID().slice(0, 8) + ".example.invalid");
    await retryModal
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await retryModal
      .getByRole("button", { name: "Настроить съём позже", exact: true })
      .click();
    let lost;
    let loseFirstResponse = true;
    await page.route(
      "**/app/api/workspaces/" + second.id + "/projects",
      async (route) => {
        if (route.request().method() !== "POST" || !loseFirstResponse) {
          await route.continue();
          return;
        }
        loseFirstResponse = false;
        const real = await route.fetch();
        assert.ok(real.ok());
        lost = (await real.json()).data;
        await route.abort("failed");
      },
    );
    await retryModal
      .getByRole("button", { name: "Создать проект", exact: true })
      .click();
    await retryModal
      .getByRole("button", { name: "Повторить", exact: true })
      .waitFor();
    await retryModal
      .getByRole("button", { name: "Повторить", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Проект настроен", exact: true })
      .waitFor();
    const secondProjects = await call(
      "GET",
      "workspaces/" + second.id + "/projects",
    );
    assert.equal(secondProjects.length, 1);
    assert.equal(secondProjects[0].id, lost.id);
    assert.equal(
      (await call("GET", "projects/" + lost.id + "/tracking-contexts")).contexts
        .length,
      0,
    );
    assert.equal(
      (await call("GET", "projects/" + lost.id + "/rank-runs")).jobs.length,
      0,
    );
    assert.deepEqual(errors, []);
  },
);
