import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { request } from "playwright";
import { crawlSiteFixture } from "./crawl-site-fixture.mjs";
import { remoteWorkerFixture } from "./remote-worker-fixture.mjs";
const execute = promisify(execFile);

test("a killed crawl coordinator resumes persisted progress and preserves saved page IDs", { skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 360000 }, async t => {
  const base = process.env.SEO_PLATFORM_PUBLIC_URL; assert.equal(base, "https://144.31.221.28:3000");
  const site = await crawlSiteFixture(t); await remoteWorkerFixture(t);
  const [user] = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
  const api = await request.newContext({ baseURL: base, storageState: user.storageState }); t.after(() => api.dispose());
  async function call(method, path, data) {
    const csrf = (await api.storageState()).cookies.find(cookie => cookie.name === "seo_csrf")?.value;
    const response = await api.fetch("/app/api/" + path, { method, headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() }, ...(data === undefined ? {} : { data }) });
    const body = await response.json(); assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${body.error?.code ?? ""}`); return body.data;
  }
  const workspace = await call("POST", "workspaces", { name: "Проверка продолжения обхода", country: "RU", locale: "ru", timezone: "Europe/Moscow", billingCurrency: "RUB" });
  const project = await call("POST", `workspaces/${workspace.id}/projects`, { name: "Продолжение после перезапуска", domain: site.domain, locale: "ru", timezone: "Europe/Moscow" });
  const urls = Array.from({ length: 24 }, (_, index) => `${site.root}throughput/3/${index}`);
  let crawl = await call("POST", `projects/${project.id}/crawls`, { purpose: "HTTP_STATUS_CHECK", startUrls: urls, sitemapUrls: [], includePatterns: [], excludePatterns: [], queryPolicy: "DROP_TRACKING", maxUrls: 24, maxDepth: 0, maxRuntimeSeconds: 300, requestsPerMinute: 180, obeyRobots: true, conditionalRequests: false, savePageMap: true });
  for (let attempt = 0; attempt < 70 && crawl.processedUrls < 2; attempt++) { await delay(200); crawl = await call("GET", `projects/${project.id}/crawls/${crawl.id}`); }
  assert.ok(crawl.processedUrls >= 2 && crawl.processedUrls < 24);
  const before = await call("GET", `projects/${project.id}/pages?limit=100&includeStructure=false`);
  const { stdout } = await execute("pgrep", ["-f", "^/home/dev/.nvm/versions/node/v24[.]18[.]1/bin/node /home/dev/projects/seo-platform/backend-execution/dist/crawl-worker[.]main[.]js$"]);
  const pids = stdout.trim().split(/\s+/u).map(Number); assert.equal(pids.length, 1);
  process.kill(pids[0], "SIGKILL");
  const saved = await call("GET", `projects/${project.id}/crawls/${crawl.id}`); assert.ok(saved.processedUrls >= crawl.processedUrls);
  let recovered = saved;
  for (let attempt = 0; attempt < 150 && ["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(recovered.status); attempt++) { await delay(2000); recovered = await call("GET", `projects/${project.id}/crawls/${crawl.id}`); }
  assert.equal(recovered.status, "COMPLETED"); assert.equal(recovered.processedUrls, 24); assert.equal(recovered.failedUrls, 0);
  const after = await call("GET", `projects/${project.id}/pages?limit=100&includeStructure=false`);
  assert.equal(after.pages.length, 24); assert.equal(new Set(after.pages.map(page => page.id)).size, 24);
  for (const page of before.pages) assert.ok(after.pages.some(current => current.id === page.id && current.normalizedUrl === page.normalizedUrl), "saved page identity must survive coordinator replacement");
  await writeFile(process.env.SEO_PLATFORM_E2E_OUTPUT_DIR + "/crawl-restart-result.json", JSON.stringify({ crawlId: crawl.id, beforeRestart: saved.processedUrls, afterRestart: recovered.processedUrls, savedPageIdsPreserved: true, failedUrls: recovered.failedUrls }, null, 2), { mode: 0o600 });
});
