import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium, request } from "playwright";

// Runs against the local production build through Caddy. Only synthetic accounts
// and keywords are changed; no provider, billing checkout or email calls.
test("tag chips: real storage, explicit bulk removal, tenant isolation and responsive dialogs", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA",
  timeout: 360_000
}, async t => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL;
  const output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
  assert.ok(base?.startsWith("https://"));
  assert.ok(output?.startsWith("/home/dev/.local/share/seo-platform-runtime/tmp/e2e."));
  const fixtures = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  assert.ok(fixtures.length >= 2 && fixtures.every(f => /^e2e-load-[0-9a-f-]+@example\.invalid$/u.test(f.email)));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const api = await request.newContext({ baseURL: base, storageState: fixtures[0].storageState });
  const outsider = await request.newContext({ baseURL: base, storageState: fixtures[1].storageState });
  const browser = await chromium.launch({ headless: true });
  let page;
  const errors = [], paidLaunches = [], report = [];
  t.after(async () => {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, "last-screen.png") });
      await writeFile(path.join(output, "last-dom.html"), await page.content(), { mode: 0o600 });
    }
    await writeFile(path.join(output, "report.json"), JSON.stringify({ report, errors, paidLaunches }, null, 2), { mode: 0o600 });
    await browser.close(); await api.dispose(); await outsider.dispose();
  });
  async function send(method, endpoint, data, { client = api, version, expected, csrf = true } = {}) {
    const token = (await client.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await client.fetch(`/app/api/${endpoint}`, {
      method,
      headers: { Origin: base, "Idempotency-Key": randomUUID(), ...(csrf && token ? { "X-CSRF-Token": token } : {}), ...(version === undefined ? {} : { "If-Match": `"v${version}"` }) },
      ...(data === undefined ? {} : { data })
    });
    const body = await response.json();
    if (expected) assert.ok(expected.includes(response.status()), `${method}: expected ${expected}, got ${response.status()} ${body.error?.code ?? ""}`);
    else assert.ok(response.ok(), `${method} ${endpoint.split("/")[0]}: ${response.status()} ${body.error?.code ?? ""}`);
    return body.data;
  }
  const fixtureFile = path.join(output, "test-data.json");
  let saved;
  try { saved = JSON.parse(await readFile(fixtureFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!saved) {
    const workspace = await send("POST", "workspaces", { name: "Tag chips E2E", country: "RU", locale: "ru", timezone: "Europe/Berlin", billingCurrency: "RUB" });
    await send("POST", `workspaces/${workspace.id}/billing/trial`);
    const project = await send("POST", `workspaces/${workspace.id}/projects`, { name: "Tag chips E2E", domain: "example.com", locale: "ru", timezone: "Europe/Berlin" });
    saved = { workspaceId: workspace.id, projectId: project.id, userId: fixtures[0].userId };
    await writeFile(fixtureFile, JSON.stringify(saved), { mode: 0o600, flag: "wx" });
  }
  assert.equal(saved.userId, fixtures[0].userId);
  const endpoint = `projects/${saved.projectId}/keywords`;
  const list = () => send("GET", `${endpoint}?pageSize=100`);
  const patch = (row, data, options) => send("PATCH", `${endpoint}/${row.id}`, data, { version: row.version, ...options });
  const sorted = tags => [...tags].sort();
  const aText = "тест тегов альфа", bText = "тест тегов бета";
  const aTags = ["Сохранить", "Только A", "Бренд, регион"], bTags = ["Только B", "Общий"];
  const run = randomUUID().slice(0, 8), customBulkTag = `Новый, особый ${run}`, customSingleTag = `Один, тег ${run}`;
  async function seed(text, tags) {
    const existing = (await list()).find(row => row.textOriginal === text);
    if (existing) return patch(existing, { tagNames: tags });
    const result = await send("POST", `${endpoint}/bulk`, { items: [{ text, language: "ru", priority: 0, isFavorite: false, isTracked: true, tagNames: tags }], duplicatePolicy: "SKIP_EXISTING" });
    assert.equal(result.created, 1);
    return (await list()).find(row => row.textOriginal === text);
  }
  const a = await seed(aText, aTags), b = await seed(bText, bTags);
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "seo_workspace", value: saved.workspaceId, url: base, secure: true, sameSite: "Lax" }, { name: "seo_project", value: saved.projectId, url: base, secure: true, sameSite: "Lax" }]);
  page = await context.newPage();
  page.on("pageerror", error => errors.push({ name: error.name, message: error.message.slice(0, 200) }));
  page.on("request", req => {
    if (req.method() === "POST" && /\/(frequency-collections|ai-answer-collections|clustering-runs|rank-runs|keyword-research-runs|checkout)$/u.test(new URL(req.url()).pathname)) paidLaunches.push(new URL(req.url()).pathname);
  });
  let locale = "ru";
  async function setLocale(next) {
    locale = next;
    await send("PATCH", "me/preferences", { locale });
    await context.addCookies([{ name: "seo_ui_locale", value: locale, url: base, secure: true, sameSite: "Lax" }]);
  }
  await setLocale("ru");
  async function openEditor(ids) {
    await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });
    for (const id of ids) await page.locator(`tr[data-presence-key="keyword:${id}"] input[type="checkbox"]`).check();
    await page.locator(`tr[data-presence-key="keyword:${ids[0]}"]`).click({ button: "right", position: { x: 80, y: 15 } });
    await page.getByRole("menuitem").nth(2).click();
    const form = page.locator(".semantic-bulk-editor");
    await form.waitFor();
    return form;
  }
  function picker(form, removing = false) { return form.locator(`.keyword-tag-picker${removing ? ".is-removal" : ":not(.is-removal)"}`); }
  async function chooseTag(field, name, { create = false } = {}) {
    await field.getByRole("combobox").click();
    const search = page.locator(".custom-select-popover .custom-select-search");
    await search.fill(name);
    const existing = page.getByRole("option", { name, exact: true });
    const option = create ? existing.or(page.getByRole("option", { name: locale === "ru" ? `Добавить «${name}»` : `Add “${name}”`, exact: true })).first() : existing;
    await option.waitFor();
    if (create && !(await existing.isVisible())) await search.press("Enter"); else await existing.click();
    await field.locator(".keyword-tag-chip > span").filter({ hasText: name }).waitFor();
  }
  async function saveEditor(form, ids) {
    const responsePromise = page.waitForResponse(response => ids.length > 1 ? response.url().endsWith(`/projects/${saved.projectId}/bulk-commands`) && response.request().method() === "POST" : response.url().endsWith(`${endpoint}/${ids[0]}`) && response.request().method() === "PATCH");
    await form.locator('button[type="submit"]').click();
    const response = await responsePromise;
    assert.ok(response.ok(), `UI save returned ${response.status()}`);
    const body = await response.json();
    if (ids.length > 1) { assert.equal(body.data.changed, ids.length); assert.equal(body.data.failed, 0); }
    await form.waitFor({ state: "hidden" });
    return response.request().postDataJSON();
  }
  async function assertLayout(form, name) {
    const width = page.viewportSize().width;
    const modal = page.locator("dialog[open].semantic-modal");
    const bounds = await modal.boundingBox();
    assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${name}: modal exceeds viewport`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: document overflow`);
    const layout = await form.evaluate(node => {
      const grid = node.querySelector(".semantic-bulk-grid"), tags = node.querySelector(".semantic-bulk-tags");
      return {
        tagsBelow: tags.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom,
        labelGaps: [...grid.querySelectorAll(":scope > label")].map(label => label.children[1].getBoundingClientRect().top - label.children[0].getBoundingClientRect().bottom),
        chipsOverflow: [...node.querySelectorAll(".keyword-tag-chips")].some(chips => chips.scrollWidth > chips.clientWidth + 1)
      };
    });
    assert.ok(layout.tagsBelow); assert.equal(layout.chipsOverflow, false);
    assert.ok(layout.labelGaps.every(gap => gap >= 0 && gap <= 12), `${name}: fields stretched ${layout.labelGaps}`);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    report.push({ name, width, ...layout });
  }

  await t.test("bulk chips preserve individual tags and support cancellable explicit removal", async () => {
    const form = await openEditor([a.id, b.id]), add = picker(form), remove = picker(form, true);
    await chooseTag(add, "Сохранить");
    await add.getByRole("button", { name: "Убрать из добавления «Сохранить»", exact: true }).click();
    await chooseTag(add, "Общий");
    await chooseTag(remove, "Общий");
    assert.equal(await add.locator(".keyword-tag-chip").count(), 0);
    await chooseTag(add, "Общий");
    assert.equal(await remove.locator(".keyword-tag-chip").count(), 0);
    await chooseTag(remove, "Только A");
    await remove.getByRole("button", { name: "Отменить снятие «Только A»", exact: true }).click();
    await chooseTag(remove, "Бренд, регион");
    await chooseTag(add, customBulkTag, { create: true });
    const extra = ["XMLStock", "Arsenkin", "Wordstat", "Keys.so", "длинный-тег-".repeat(12)];
    for (const tag of extra) await chooseTag(add, tag, { create: true });
    await assertLayout(form, "bulk-many-chips");
    const body = await saveEditor(form, [a.id, b.id]);
    assert.deepEqual(sorted(body.patch.addTagNames), sorted(["Общий", customBulkTag, ...extra]));
    assert.deepEqual(body.patch.removeTagNames, ["Бренд, регион"]);
    assert.equal(body.patch.tagNames, undefined);
    const rows = await list();
    assert.deepEqual(sorted(rows.find(row => row.id === a.id).tags), sorted(["Сохранить", "Только A", "Общий", customBulkTag, ...extra]));
    assert.deepEqual(sorted(rows.find(row => row.id === b.id).tags), sorted([...bTags, customBulkTag, ...extra]));
  });
  await t.test("a single chip removes exactly one persisted tag; commas remain inside one tag", async () => {
    const before = (await list()).find(row => row.id === a.id);
    const form = await openEditor([a.id]), field = picker(form);
    await field.getByRole("button", { name: "Снять тег «Сохранить»", exact: true }).click();
    await chooseTag(field, customSingleTag, { create: true });
    const body = await saveEditor(form, [a.id]);
    assert.deepEqual(body, { addTagNames: [customSingleTag], removeTagNames: ["Сохранить"] });
    const after = (await list()).find(row => row.id === a.id);
    assert.deepEqual(sorted(after.tags), sorted([...before.tags.filter(tag => tag !== "Сохранить"), customSingleTag]));
  });
  await t.test("manual keyword creation uses selectable, removable chips", async () => {
    await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });
    await page.locator('[data-presence-key="semantic-action:add"]').click();
    const form = page.locator(".semantic-editor"), field = picker(form);
    const text = `ручное добавление ${randomUUID()}`;
    await form.locator("textarea").fill(text);
    await chooseTag(field, "Сохранить");
    await field.getByRole("button", { name: "Снять тег «Сохранить»", exact: true }).click();
    await chooseTag(field, "Только B");
    await chooseTag(field, "Создан, вручную", { create: true });
    await page.getByRole("button", { name: "Проверить и добавить", exact: true }).click();
    await form.waitFor({ state: "hidden" });
    assert.deepEqual(sorted((await list()).find(row => row.textOriginal === text).tags), sorted(["Только B", "Создан, вручную"]));
  });
  await t.test("real API: tag cap rollback, mixed bulk results, CAS, case dedupe and tenant/CSRF boundaries", async () => {
    const fullTags = Array.from({ length: 50 }, (_, index) => `Лимит ${index}`);
    const full = await seed("проверка лимита тегов", fullTags);
    const currentB = (await list()).find(row => row.id === b.id);
    const bulk = await send("POST", `projects/${saved.projectId}/bulk-commands`, { items: [full, currentB].map(row => ({ id: row.id, version: row.version })), patch: { addTagNames: ["Дополнительный"] } });
    assert.equal(bulk.failed, 1); assert.equal(bulk.changed, 1);
    let currentFull = (await list()).find(row => row.id === full.id);
    assert.equal(currentFull.version, full.version); assert.deepEqual(sorted(currentFull.tags), sorted(fullTags));
    await patch(currentFull, { addTagNames: ["Ещё один"] }, { expected: [422] });
    await patch(currentFull, { addTagNames: ["Замена одного"], removeTagNames: ["Лимит 0"] });
    currentFull = (await list()).find(row => row.id === full.id);
    assert.equal(currentFull.tags.length, 50); assert.ok(!currentFull.tags.includes("Лимит 0"));
    await patch(full, { removeTagNames: ["Лимит 1"] }, { expected: [412, 409] });
    await patch(currentFull, { removeTagNames: ["Лимит 1"] }, { client: outsider, expected: [403, 404] });
    await patch(currentFull, { removeTagNames: ["Лимит 1"] }, { csrf: false, expected: [403] });
    await patch(currentFull, { tagNames: [], removeTagNames: ["Лимит 1"] }, { expected: [422] });
    await send("POST", `projects/${saved.projectId}/bulk-commands`, { items: [{ id: currentFull.id, version: currentFull.version }], patch: { addTagNames: ["ОБЩИЙ"], removeTagNames: ["общий"] } }, { expected: [422] });
    assert.deepEqual((await list()).find(row => row.id === full.id), currentFull);
    const row = (await list()).find(row => row.id === b.id);
    await patch(row, { addTagNames: ["общий", "ОБЩИЙ"] });
    assert.deepEqual(sorted((await list()).find(item => item.id === b.id).tags), sorted(row.tags));
    await send("GET", `${endpoint}/tag-options`, undefined, { client: outsider, expected: [403, 404] });
  });
  await t.test("failed suggestions can retry and custom entry remains available", async () => {
    await page.route("**/keywords/tag-options*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Temporary test outage" } }) }));
    const form = await openEditor([a.id, b.id]), field = picker(form);
    await field.getByRole("button", { name: "Повторить", exact: true }).waitFor();
    const finalOutage = page.waitForResponse(response => response.url().endsWith("/keywords/tag-options") && response.status() === 503);
    await chooseTag(field, "При сбое, один тег", { create: true });
    await finalOutage;
    await field.getByRole("button", { name: "Повторить", exact: true }).waitFor();
    await page.unroute("**/keywords/tag-options*");
    await field.getByRole("button", { name: "Повторить", exact: true }).click();
    await chooseTag(field, "Сохранить");
    await form.getByRole("button", { name: "Отмена", exact: true }).click();
  });
  await t.test("RU/EN desktop and phone: aligned fields, bounded chips and a single search outline", async () => {
    for (const language of ["ru", "en"]) {
      await setLocale(language);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const single of [false, true]) {
          const form = await openEditor(single ? [b.id] : [a.id, b.id]), field = picker(form);
          await chooseTag(field, "Сохранить");
          assert.ok((await field.locator(".keyword-tag-chips").innerText()).includes("Сохранить"), "User tags must not be translated");
          const name = `${language}-${width}-${single ? "single" : "bulk"}`;
          await assertLayout(form, name);
          await field.getByRole("combobox").click();
          const search = page.locator(".custom-select-popover .custom-select-search");
          await search.fill("несуществующий-тег-".repeat(8));
          const popover = page.locator(".custom-select-popover");
          const bounds = await popover.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 1001, `${name}: popover escapes viewport`);
          const style = await search.evaluate(input => {
            const css = getComputedStyle(input), rect = input.getBoundingClientRect(), parent = input.parentElement.getBoundingClientRect();
            return { border: css.borderWidth, shadow: css.boxShadow, outline: css.outlineWidth, inside: rect.left >= parent.left && rect.right <= parent.right && rect.height <= parent.height };
          });
          assert.deepEqual(style, { border: "0px", shadow: "none", outline: "0px", inside: true });
          await page.screenshot({ path: path.join(output, `${name}-search.png`) });
          await search.press("Escape");
          await page.locator("dialog[open] .semantic-modal-close").click();
        }
      }
    }
  });
  assert.deepEqual(errors, []); assert.deepEqual(paidLaunches, []);
});
