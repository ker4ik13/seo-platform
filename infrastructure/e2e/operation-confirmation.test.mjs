import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium, request } from "playwright";

const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
test("paid confirmation UI: insufficient balance, cancellation, expired price, refresh and recovery after a lost response", { skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA" || !process.env.SEO_PLATFORM_SESSION_FIXTURES, timeout: 180_000 }, async t => {
  assert.ok(base?.startsWith("https://")); assert.ok(output?.startsWith("/"));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const fixture = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"))[13];
  assert.match(fixture.email, /^e2e-load-[0-9a-f-]+@example\.invalid$/u);
  const api = await request.newContext({ baseURL: base, storageState: fixture.storageState });
  const browser = await chromium.launch({ headless: true }); let page;
  t.after(async () => { if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "last-screen.png") }); await browser.close(); await api.dispose(); });
  async function command(method, endpoint, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, { method, headers: { Origin: base, "Idempotency-Key": randomUUID(), ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, ...(data === undefined ? {} : { data }) });
    const body = await response.json(); assert.ok(response.ok(), `${method} ${endpoint.split("/")[0]}: ${response.status()} ${body.error?.code ?? ""}`); return body.data;
  }
  const workspace = await command("POST", "workspaces", { name: "Paid dialog fixture", country: "RU", locale: "en", timezone: "Europe/Berlin", billingCurrency: "RUB" });
  await command("POST", `workspaces/${workspace.id}/billing/trial`);
  const project = await command("POST", `workspaces/${workspace.id}/projects`, { name: "Confirmation fixture", domain: "example.com", locale: "en", timezone: "Europe/Berlin" });
  await command("POST", `projects/${project.id}/keywords/bulk`, { items: [{ text: "confirmation fixture", language: "en", priority: 0, isFavorite: false, isTracked: true, tagNames: [] }], duplicatePolicy: "SKIP_EXISTING" });
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "seo_workspace", value: workspace.id, url: base, secure: true, sameSite: "Lax" }, { name: "seo_project", value: project.id, url: base, secure: true, sameSite: "Lax" }, { name: "seo_ui_locale", value: "en", url: base, secure: true, sameSite: "Lax" }]);
  page = await context.newPage(); const errors = [], creates = []; let quoteCalls = 0;
  page.on("pageerror", error => errors.push(error.name));
  const credentialId = randomUUID(), bindingId = randomUUID();
  // Provider and price replies below are explicit controlled fixtures. Tenant,
  // sessions, keywords and application rendering use the real Caddy runtime.
  await page.route(`**/app/api/projects/${project.id}/integration-settings`, route => route.fulfill({ json: { data: {
    credentialOptions: [{ id: credentialId, workspaceId: workspace.id, provider: "XMLSTOCK", label: "Platform XMLStock", mode: "PLATFORM_PAID", status: "ACTIVE", capabilities: ["WORDSTAT"] }], credentialOptionsTruncated: false,
    bindings: [{ id: bindingId, workspaceId: workspace.id, projectId: project.id, capability: "WORDSTAT", enabled: true, availability: "READY", version: 1, fallbackPolicy: { mode: "NONE" }, budgetPolicy: { mode: "DISABLED" }, route: { id: randomUUID(), bindingId, workspaceId: workspace.id, projectId: project.id, position: 0, sourceKind: "WORKSPACE_CREDENTIAL", credentialId, provider: "XMLSTOCK", credentialMode: "PLATFORM_PAID" } }],
    access: { canUpdateBindings: true, canUseSystemCredentials: true, canManageFallback: false, canSetBudgets: false, mutationRestriction: "NONE" }
  } } }));
  await page.route(`**/app/api/projects/${project.id}/operation-estimates`, route => {
    quoteCalls++;
    const incoming = route.request().postDataJSON(); assert.equal(incoming.kind, "FREQUENCY_COLLECTION"); assert.equal(incoming.command.items.length, 1);
    return route.fulfill({ json: { data: { id: quoteCalls === 1 ? null : randomUUID(), workspaceId: workspace.id, projectId: project.id, kind: "FREQUENCY_COLLECTION", provider: "XMLSTOCK", credentialMode: "PLATFORM_PAID", currency: "RUB", maximumChargeMinor: quoteCalls > 2 ? 456 : 123, quantity: 1, affordable: quoteCalls !== 1, expiresAt: new Date(Date.now() + (quoteCalls === 3 ? -1000 : 60_000)).toISOString(), priceBookVersion: "controlled-fixture" } } });
  });
  await page.route(`**/app/api/projects/${project.id}/frequency-collections`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    creates.push({ key: route.request().headers()["idempotency-key"], quoteId: route.request().headers()["x-operation-estimate-id"], body: route.request().postDataJSON() });
    if (creates.length === 1) return route.fulfill({ status: 503, json: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Test: response lost after committing the operation", retryable: true } } });
    return route.fulfill({ json: { data: { id: randomUUID(), projectId: project.id, workspaceId: workspace.id, provider: "XMLSTOCK", credentialMode: "PLATFORM_PAID", status: "QUEUED", version: 1 } } });
  });
  await page.goto(`${base}/app/semantics`, { waitUntil: "networkidle" });
  await page.locator('[data-presence-key="semantic-action:wordstat"]').click();
  await page.getByRole("menuitem").first().click();
  const form = page.locator('.semantic-frequency-dialog'), launch = page.locator('dialog[open]').filter({ has: form }).locator('.semantic-modal-footer button[type="submit"]');
  await page.waitForFunction(() => { const button = document.querySelector('dialog[open] .semantic-modal-footer button[type="submit"]'); return button && !button.disabled; });
  const confirmation = page.getByRole("dialog", { name: "Confirm operation cost", exact: true });
  await launch.click(); await confirmation.waitFor();
  const approve = confirmation.getByRole("button", { name: /Run for up to/u });
  assert.equal(await approve.isDisabled(), true);
  await page.screenshot({ path: path.join(output, "insufficient-desktop.png") });
  await confirmation.getByRole("button", { name: "Refresh estimate and balance", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] button')].some(button => button.textContent.startsWith('Run for up to') && !button.disabled));
  await page.setViewportSize({ width: 390, height: 950 });
  await page.screenshot({ path: path.join(output, "confirmed-mobile.png") });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click(); await confirmation.waitFor({ state: "hidden" });
  assert.equal(creates.length, 0); assert.equal(await form.locator('[role="alert"]').count(), 0);
  await launch.click(); await confirmation.waitFor(); assert.equal(await approve.isDisabled(), true);
  await confirmation.getByRole("button", { name: "Refresh estimate and balance", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] button')].some(button => button.textContent.startsWith('Run for up to') && !button.disabled));
  await approve.click(); await confirmation.waitFor({ state: "hidden" }); await form.getByRole("alert").waitFor();
  assert.equal(creates.length, 1);
  await launch.click(); await form.waitFor({ state: "hidden" });
  assert.equal(quoteCalls, 4, "Recovery must not buy a second quote"); assert.equal(creates.length, 2);
  assert.deepEqual(creates[0], creates[1], "The exact approved quote and command are replayed after an ambiguous response");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "confirmation-report.json"), JSON.stringify({ quoteCalls, createCalls: creates.length, exactReplay: true, externalProviderCalls: 0, billingFixtures: true, clientErrors: errors }), { mode: 0o600 });
});
