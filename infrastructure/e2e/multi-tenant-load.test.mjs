import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { request } from "playwright";

const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
test("12 authenticated tenants through Caddy: concurrent semantic, billing usage and project reads stay isolated", { skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 240_000 }, async t => {
  assert.ok(base?.startsWith("https://")); assert.ok(output?.startsWith("/"));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const clients = [], tenants = [], latencies = [];
  const fixtures = process.env.SEO_PLATFORM_SESSION_FIXTURES ? JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8")) : undefined;
  if (fixtures) assert.ok(fixtures.length >= 12 && fixtures.every(item => /^e2e-load-[0-9a-f-]+@example\.invalid$/u.test(item.email)));
  t.after(async () => { await Promise.all(clients.map(client => client.dispose())); });
  async function command(api, method, endpoint, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch(`/app/api/${endpoint}`, { method, headers: { Origin: base, "Idempotency-Key": randomUUID(), ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, ...(data === undefined ? {} : { data }) });
    const body = await response.json(); assert.ok(response.ok(), `${method} ${endpoint.split("/")[0]}: ${response.status()} ${body.error?.code ?? ""}`); return body.data;
  }
  for (let offset = 0; offset < 12; offset += 4) {
    tenants.push(...await Promise.all(Array.from({ length: 4 }, async (_, local) => {
      const index = offset + local, nonce = randomUUID(), api = await request.newContext({ baseURL: base, ...(fixtures ? { storageState: fixtures[index].storageState } : {}) }); clients.push(api);
      if (!fixtures) await command(api, "POST", "auth/register", { email: `load-${nonce}@example.invalid`, password: `${randomBytes(24).toString("base64url")}!Aa9`, displayName: `MVP load ${index}`, country: "RU", locale: "en", timezone: "Europe/Berlin", termsVersion: "2026-09-07", privacyVersion: "2026-09-07", marketingVersion: "2026-09-07", termsAccepted: true, privacyAccepted: true, marketingAccepted: false });
      const workspaces = await command(api, "GET", "workspaces");
      let workspace = workspaces.find(row => row.name === `MVP load ${index}`);
      if (!workspace) {
        workspace = await command(api, "POST", "workspaces", { name: `MVP load ${index}`, country: "RU", locale: "en", timezone: "Europe/Berlin", billingCurrency: "RUB" });
        await command(api, "POST", `workspaces/${workspace.id}/billing/trial`);
      }
      const projects = await command(api, "GET", `workspaces/${workspace.id}/projects`);
      const project = projects.find(row => row.name === `Load project ${index}`) ?? await command(api, "POST", `workspaces/${workspace.id}/projects`, { name: `Load project ${index}`, domain: "example.com", locale: "en", timezone: "Europe/Berlin" });
      const keyword = `mvp load tenant ${index} ${fixtures?.[index]?.userId ?? nonce}`;
      await command(api, "POST", `projects/${project.id}/keywords/bulk`, { items: [{ text: keyword, language: "en", priority: 0, isFavorite: false, isTracked: true, tagNames: [] }], duplicatePolicy: "SKIP_EXISTING" });
      return { api, workspace, project, keyword };
    })));
  }
  const started = performance.now();
  await Promise.all(tenants.map(async tenant => {
    for (let i = 0; i < 15; i++) {
      const endpoint = i % 3 === 0 ? `projects/${tenant.project.id}/keywords?pageSize=100` : i % 3 === 1 ? `workspaces/${tenant.workspace.id}/billing/usage` : `projects/${tenant.project.id}`;
      const before = performance.now(), response = await tenant.api.get(`/app/api/${endpoint}`);
      assert.equal(response.status(), 200, `Concurrent ${endpoint.split("/")[0]} read`);
      const body = await response.json(), serialized = JSON.stringify(body);
      if (i % 3 === 0) assert.ok(serialized.includes(tenant.keyword), "Correct tenant keyword is returned");
      for (const other of tenants) if (other !== tenant) assert.ok(!serialized.includes(other.keyword), "Foreign tenant content must never appear");
      latencies.push(performance.now() - before);
    }
    const other = tenants.find(item => item !== tenant);
    assert.ok([403, 404].includes((await tenant.api.get(`/app/api/projects/${other.project.id}/keywords`)).status()));
  }));
  latencies.sort((a, b) => a - b);
  assert.equal(latencies.length, 180);
  const report = { tenants: 12, concurrency: 12, successfulReads: 180, deniedCrossTenantReads: 12, providerRequests: 0, totalMs: Math.round(performance.now() - started), p50Ms: Math.round(latencies[89]), p95Ms: Math.round(latencies[170]), maximumMs: Math.round(latencies.at(-1)) };
  await writeFile(path.join(output, "multi-tenant-load.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report)}\n`);
});
