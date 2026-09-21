import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import test from "node:test";
import { chromium, request } from "playwright";

test("saved Google SPB competitor-only AI results appear in inspector, details and history", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 120_000
}, async t => {
  // Local fixture seeding uses the owning service's authenticated persistence API.
  const runtime = parseEnv(await readFile("/home/dev/.local/share/seo-platform-runtime/runtime.env", "utf8"));
  const base = process.env.SEO_PLATFORM_PUBLIC_URL;
  assert.equal(base, runtime.SEO_PLATFORM_PUBLIC_URL);
  assert.ok(base.startsWith("https://"));
  const output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
  assert.ok(output?.startsWith("/home/dev/.local/share/seo-platform-runtime/tmp/e2e."));
  await mkdir(output, { recursive: true });
  const [fixture] = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  assert.match(fixture.email, /^e2e-load-[0-9a-f-]+@example\.invalid$/u);
  const api = await request.newContext({ baseURL: base, storageState: fixture.storageState });
  const browser = await chromium.launch({ headless: true });
  let page;
  t.after(async () => {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "ai-competitor-last.png") });
    await browser.close(); await api.dispose();
  });
  async function command(method, endpoint, data) {
    const csrf = (await api.storageState()).cookies.find(c => c.name === "seo_csrf")?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, {
      method, headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() }, ...(data === undefined ? {} : { data })
    });
    const body = await response.json();
    assert.ok(response.ok(), `${method} ${endpoint}: ${response.status()} ${body.error?.code ?? ""}`);
    return body.data;
  }
  await command("PATCH", "me/preferences", { locale: "ru" });
  const workspace = await command("POST", "workspaces", { name: "AI competitor regression", country: "RU", locale: "ru", timezone: "Europe/Berlin", billingCurrency: "RUB" });
  const project = await command("POST", `workspaces/${workspace.id}/projects`, { name: "ИИ-конкуренты СПБ", domain: "example.com", locale: "ru", timezone: "Europe/Berlin" });
  await command("POST", `projects/${project.id}/keywords/bulk`, {
    items: ["ёлки с источниками", "ёлки ответ без ссылок", "ёлки без ИИ-ответа"].map(text => ({ text, language: "ru", priority: 0, isFavorite: false, isTracked: true, tagNames: [] })), duplicatePolicy: "SKIP_EXISTING"
  });
  const keywords = await command("GET", `projects/${project.id}/keywords?limit=100`);
  for (const keyword of keywords) {
    const withSources = keyword.textOriginal === "ёлки с источниками";
    const answerPresent = keyword.textOriginal !== "ёлки без ИИ-ответа";
    const body = {
      workspaceId: workspace.id, projectId: project.id, actorId: fixture.userId, jobId: randomUUID(),
      searchEngine: "GOOGLE", regionCode: "1012040", device: "DESKTOP", provider: "ARSENKIN", host: "example.com", observedAt: new Date().toISOString(),
      items: [{ keywordId: keyword.id, keywordVersion: keyword.version, positionTrackingEnabled: false, snapshot: {
        answerPresent, siteFound: false, brandFound: false,
        ...(answerPresent ? { answerMarkdown: "Сохранённый ИИ-ответ о ёлках в Санкт-Петербурге." } : {}),
        sources: withSources ? [{ url: "https://competitor.example/trees", title: "Ёлки конкурента", description: "Источник Google AI" }] : []
      } }]
    };
    const response = await fetch(`http://127.0.0.1:4001/internal/v1/projects/${project.id}/ai-answers/snapshots-batch`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Token": runtime.JOBS_TO_SEO_DATA_TOKEN, "X-Workspace-Id": workspace.id, "X-Project-Id": project.id, "X-Actor-Id": fixture.userId }, body: JSON.stringify(body)
    });
    assert.ok(response.ok, `Local snapshot persistence: ${response.status}`);
    const insights = await command("GET", `projects/${project.id}/keywords/${keyword.id}/insights`);
    assert.deepEqual(insights.aiPositionHistory, []);
    assert.equal(insights.aiCompetitorSnapshots[0].answerPresent, answerPresent);
    assert.equal(insights.aiCompetitorSnapshots[0].results.length, withSources ? 1 : 0);
    assert.equal((await command("GET", `projects/${project.id}/keywords/${keyword.id}/ai-answers/history?limit=200`)).length, 0);
    assert.equal((await command("GET", `projects/${project.id}/keywords/${keyword.id}/ai-answers/history?limit=200&includeCompetitors=true`)).length, 1);
  }
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base }, { name: "seo_project", value: project.id, url: base }]);
  page = await context.newPage();
  const errors = [], paidRequests = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (r.method() === "POST" && /\/(ai-answer-collections|operation-estimates)$/u.test(new URL(r.url()).pathname)) paidRequests.push(r.url()); });
  await page.goto(`${base}/app/semantics`);
  for (const keyword of keywords) {
    await page.locator(`tr[data-presence-row-id="${keyword.id}"] .semantic-query-text`).click();
    const inspector = page.locator(".semantic-keyword-inspector");
    await inspector.getByRole("tab", { name: "Выдача", exact: true }).click();
    await inspector.getByRole("tab", { name: "ИИ выдача", exact: true }).click();
    await inspector.getByText("Топ конкурентов ИИ (Google)", { exact: true }).waitFor();
    await inspector.getByText("Санкт-Петербург", { exact: true }).first().waitFor();
    if (keyword.textOriginal === "ёлки с источниками") await inspector.getByText("Ёлки конкурента", { exact: true }).waitFor();
    else await inspector.getByText("Съём сохранён", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${keyword.id}-inspector.png`) });
    await inspector.getByRole("button", { name: "История ИИ-выдачи и конкурентов", exact: true }).click();
    await page.locator("dialog[open]").last().getByText("Санкт-Петербург", { exact: false }).first().waitFor();
    await page.locator("dialog[open]").last().locator(".semantic-modal-close").click();
    await inspector.getByRole("button", { name: "Открыть ИИ-ответ", exact: true }).click();
    const modal = page.locator("dialog[open]").last();
    if (keyword.textOriginal !== "ёлки без ИИ-ответа") await modal.getByText("Сохранённый ИИ-ответ о ёлках в Санкт-Петербурге.", { exact: true }).waitFor();
    await modal.locator(".semantic-modal-close").click();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(paidRequests, []);
});
