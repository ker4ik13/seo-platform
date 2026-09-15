import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { chromium, request } from "playwright";

const enabled = process.env.SEO_PLATFORM_E2E_CONFIRM === "CREATE_TEST_DATA";
const base = process.env.SEO_PLATFORM_PUBLIC_URL;
const output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;

test("production runtime through Caddy: tenant security, real writes and responsive settings", {
  skip: !enabled,
  timeout: 600_000
}, async (t) => {
  assert.ok(base?.startsWith("https://"), "SEO_PLATFORM_PUBLIC_URL must use HTTPS/Caddy");
  assert.ok(output?.startsWith("/"), "Set an absolute E2E output directory");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true });
  const clients = [];
  t.after(async () => {
    await browser.close();
    await Promise.all(clients.map(client => client.dispose()));
  });
  async function tenant(label) {
    const api = await request.newContext({ baseURL: base });
    clients.push(api);
    const email = `runtime-e2e-${randomUUID()}@example.invalid`;
    await command(api, "POST", "auth/register", {
      email, password: `${randomBytes(24).toString("base64url")}!Aa9`,
      displayName: `Проверка ${label}`, country: "DE", locale: "ru", timezone: "Europe/Berlin",
      termsVersion: "2026-07-01", privacyVersion: "2026-07-01", marketingVersion: "2026-07-01",
      termsAccepted: true, privacyAccepted: true, marketingAccepted: false
    });
    const workspace = await command(api, "POST", "workspaces", { name: `E2E ${label}`, country: "DE", locale: "ru", timezone: "Europe/Berlin", billingCurrency: "RUB" });
    await command(api, "POST", `workspaces/${workspace.id}/billing/trial`);
    const project = await command(api, "POST", `workspaces/${workspace.id}/projects`, { name: `Проект ${label}`, domain: "example.com", locale: "ru", timezone: "Europe/Berlin" });
    return { api, workspace, project, email };
  }
  const first = await tenant("настройки");
  const other = await tenant("чужая область");
  const context = await browser.newContext({ storageState: await first.api.storageState() });
  await context.addCookies([
    { name: "seo_workspace", value: first.workspace.id, url: base, secure: true, sameSite: "Lax" },
    { name: "seo_project", value: first.project.id, url: base, secure: true, sameSite: "Lax" }
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.name));
  const pid = first.project.id;

  await t.test("cross-tenant requests, forged context, CSRF and internal routes fail closed", async () => {
    for (const path of [`workspaces/${other.workspace.id}`, `projects/${other.project.id}`, `projects/${other.project.id}/keywords`]) {
      const response = await first.api.get(`/app/api/${path}`, { headers: { "x-workspace-id": other.workspace.id, "x-actor-id": randomUUID() } });
      assert.ok([403, 404].includes(response.status()), `${path.split("/")[0]} isolation: ${response.status()}`);
    }
    const anonymous = await request.newContext({ baseURL: base });
    clients.push(anonymous);
    assert.equal((await anonymous.get(`/app/api/projects/${pid}/keywords`)).status(), 401);
    const csrf = await first.api.patch(`/app/api/workspaces/${first.workspace.id}`, { headers: { Origin: base, "If-Match": `"v${first.workspace.version}"` }, data: { name: "forbidden" } });
    assert.equal(csrf.status(), 403);
    const foreignOrigin = await first.api.post("/app/api/workspaces", { headers: { Origin: "https://attacker.example" }, data: {} });
    assert.equal(foreignOrigin.status(), 403);
    for (const path of ["/app/api/internal/v1/projects", "/app/api/admin/workspaces", "/internal/v1/health/ready"]) {
      assert.equal((await anonymous.get(path)).status(), 404);
    }
    const storage = await first.api.put("/app/api/storage-upload", { headers: { Origin: base, "x-seo-storage-url": "http://169.254.169.254/latest/meta-data" }, data: "x" });
    assert.equal(storage.status(), 400);
  });

  await t.test("parallel versioned writes cannot silently overwrite one another", async () => {
    const current = await command(first.api, "GET", `workspaces/${first.workspace.id}`);
    const responses = await Promise.all(["Первый черновик", "Второй черновик"].map(name => raw(first.api, "PATCH", `workspaces/${first.workspace.id}`, { name }, { "If-Match": `"v${current.version}"` })));
    assert.equal(responses.filter(r => r.status() === 200).length, 1);
    assert.equal(responses.filter(r => [409, 412].includes(r.status())).length, 1);
    const saved = await command(first.api, "GET", `workspaces/${first.workspace.id}`);
    assert.equal(saved.version, current.version + 1);
  });

  await t.test("public note safely renders hostile Markdown and revokes its share URL", async () => {
    const note = await command(first.api, "POST", `projects/${pid}/notes`, {
      title: "Проверка публикации", markdown: '# Тестовая заметка\n\n<script>window.__auditXss=1</script>\n\n[Небезопасная ссылка](javascript:alert(1))', visibility: "PUBLIC"
    });
    assert.ok(note.publicToken || note.publicUrl, "Public note should expose its share reference to its owner");
    const publicPath = note.publicUrl ? new URL(note.publicUrl, base).pathname : `/notes/${note.publicToken}`;
    const response = await page.goto(`${base}${publicPath}`);
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: "Проверка публикации", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__auditXss === undefined), true);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    assert.match(response.headers()["x-robots-tag"] ?? "", /noindex/u);
    await command(first.api, "PATCH", `projects/${pid}/notes/${note.id}`, { visibility: "PROJECT_MEMBERS" }, { "If-Match": `"v${note.version}"` });
    assert.equal((await first.api.get(`/app/api/public/project-notes/${note.publicToken}`)).status(), 404);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Заметка недоступна", { exact: true }).waitFor();
  });

  await t.test("real ClamAV rejects the standard harmless EICAR test upload", async () => {
    const bytes = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const upload = await command(first.api, "POST", `projects/${pid}/uploads`, { fileName: "antivirus-audit.csv", mediaType: "text/csv", sizeBytes: String(bytes.length) });
    const parts = await command(first.api, "POST", `projects/${pid}/uploads/${upload.upload.id}/parts`, { partNumbers: [1] });
    const response = await first.api.put('/app/api/storage-upload', { headers: { Origin: base, 'Content-Type': 'text/csv', 'x-seo-storage-url': parts.parts[0].url }, data: bytes });
    assert.equal(response.status(), 204);
    const etag = response.headers().etag;
    assert.ok(etag);
    await command(first.api, "POST", `projects/${pid}/uploads/${upload.upload.id}/complete`, { parts: [{ partNumber: 1, etag }] });
    let status;
    for (let attempt = 0; attempt < 60; attempt++) {
      const current = await command(first.api, "GET", `projects/${pid}/uploads/${upload.upload.id}`);
      status = current.status;
      if (["READY", "REJECTED"].includes(status)) break;
      await delay(500);
    }
    assert.equal(status, "REJECTED", "ClamAV must prevent the canary from becoming a usable import");
  });

  await t.test("bounded concurrent HTTPS reads complete without errors", async () => {
    const latencies = [];
    let index = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (index++ < 120) {
        const start = performance.now();
        const response = await first.api.get(`/app/api/projects/${pid}/keywords?pageSize=20`);
        assert.equal(response.status(), 200);
        await response.body();
        latencies.push(performance.now() - start);
      }
    }));
    latencies.sort((a, b) => a - b);
    assert.equal(latencies.length, 120);
    await writeFile(join(output, "https-load.json"), JSON.stringify({ requests: 120, concurrency: 8, errors: 0, p50Ms: latencies[60], p95Ms: latencies[113], maximumMs: latencies.at(-1) }, null, 2), { mode: 0o600 });
  });

  await t.test("main workspaces and public pages render on desktop and phone", async () => {
    const routes = ["/ru", "/en", "/docs/api", "/app", "/app/semantics", "/app/tasks", "/app/tools", "/app/projects", "/app/competitors", `/app/projects/${pid}/pages`, `/app/projects/${pid}/notes`, `/app/projects/${pid}/rankings`];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [index, path] of routes.entries()) {
        const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
        assert.equal(response.status(), 200, `Main screen ${index}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Main screen ${index}: document overflow at ${width}`);
        await page.screenshot({ path: join(output, `main-${width}-${index}.png`), fullPage: true });
      }
    }
  });

  await t.test("settings render at 320/390/768/1440px without document overflow or client exceptions", async () => {
    const routes = ["/app/settings", ...["workspace", "security", "billing", "integrations", "team", "roles", "api", "notifications", "projects"].map(name => `/app/settings/${name}`), ...["general", "integrations", "notifications"].map(name => `/app/projects/${pid}/settings/${name}`), `/app/projects/${pid}/rankings/contexts`];
    const report = [];
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [index, path] of routes.entries()) {
        const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
        assert.equal(response.status(), 200, `${index}: HTTP status`);
        assert.equal(await page.locator("h1").count(), 1, `${index}: one page heading`);
        assert.equal(await page.locator(".settings-tabs a[aria-current=page]").count(), 1, `${index}: current settings section`);
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert.ok(dimensions.document <= width + 1, `${index} overflows at ${width}px`);
        const heading = await page.locator('.page-heading').boundingBox();
        const navigation = await page.locator('.settings-tabs').boundingBox();
        const separated = heading && navigation && (
          navigation.y >= heading.y + heading.height - 1 ||
          navigation.x + navigation.width <= heading.x + 1 ||
          heading.x + heading.width <= navigation.x + 1
        );
        assert.ok(separated, `${index}: settings navigation overlaps the page heading`);
        if (path === "/app/settings/billing") {
          assert.equal(await page.locator('.billing-cancel-subscription').count(), 0, "A permanent free tier has no paid renewal to cancel");
          assert.equal(/9999|10000/u.test(await page.locator('.billing-stack').innerText()), false, "Do not expose the free-tier date sentinel");
        }
        const filename = `settings-${width}-${index}.png`;
        await page.screenshot({ path: join(output, filename), fullPage: true });
        report.push({ width, screen: index, status: response.status(), ...dimensions, screenshot: filename });
      }
    }
    await writeFile(join(output, "visual-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    assert.deepEqual(errors, [], "Unexpected client exception during settings navigation");
  });

  await t.test("mobile settings menu shows the current section and closes after navigation", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/app/settings/workspace`, { waitUntil: "networkidle" });
    const toggle = page.getByRole("button", { name: "Разделы настроек: Рабочая область", exact: true });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await page.locator('.settings-tabs a[href="/app/settings/security"]').click();
    await page.waitForURL("**/app/settings/security");
    assert.equal(await page.getByRole("button", { name: "Разделы настроек: Профиль и безопасность", exact: true }).getAttribute("aria-expanded"), "false");
  });

  await t.test("workspace form keeps its grid while saving and persists the actual edit", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/app/settings/workspace`, { waitUntil: "networkidle" });
    const field = page.locator('#workspace-settings-form input').first();
    const name = `Сохранено ${Date.now()}`;
    await field.fill(name);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const path = `**/app/api/workspaces/${first.workspace.id}`;
    await page.route(path, async route => {
      if (route.request().method() === "PATCH") await gate;
      await route.continue();
    });
    const card = page.locator('.security-card').filter({ has: page.locator('#workspace-settings-form') });
    const before = await card.evaluate(node => getComputedStyle(node).gridTemplateColumns);
    await page.locator('#workspace-settings-form').getByRole("button", { name: "Сохранить", exact: true }).click();
    try {
      await page.waitForSelector('.security-card[aria-busy="true"]');
      assert.equal(await card.evaluate(node => getComputedStyle(node).gridTemplateColumns), before);
    } finally { release(); }
    await page.getByText("Настройки рабочей области сохранены.", { exact: true }).waitFor();
    await page.unroute(path);
    const stored = await command(first.api, "GET", `workspaces/${first.workspace.id}`);
    assert.equal(stored.name, name);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await field.inputValue(), name);
  });

  await t.test("recoverable settings failure has an error state and a working retry", async () => {
    const path = "**/app/api/me/notification-preferences";
    let fail = true;
    await page.route(path, async route => {
      if (fail) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "Сервис временно недоступен", retryable: true } }) });
      else await route.continue();
    });
    await page.goto(`${base}/app/settings/notifications`, { waitUntil: "networkidle" });
    // The response interception is fault injection; all successful reads and
    // writes in the suite use the real running services and databases.
    const alert = page.getByRole("alert").first();
    await alert.waitFor();
    fail = false;
    await page.getByRole("button", { name: /Повторить|Попробовать снова/u }).first().click();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.getByText("Сервис временно недоступен", { exact: true }).count(), 0);
    await page.unroute(path);
  });
});

async function raw(api, method, path, data, extraHeaders = {}) {
  const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
  return api.fetch(`/app/api/${path}`, { method, headers: { Origin: base, ...(csrf ? { "X-CSRF-Token": csrf } : {}), "Idempotency-Key": randomUUID(), ...extraHeaders }, ...(data !== undefined ? { data } : {}), timeout: 30_000 });
}
async function command(api, method, path, data, headers) {
  const response = await raw(api, method, path, data, headers);
  const payload = await response.json();
  assert.ok(response.ok(), `${method} ${path.split("/")[0]}: ${response.status()} ${payload.error?.code ?? ""}`);
  return payload.data;
}
