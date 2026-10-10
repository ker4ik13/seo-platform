import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

assert.equal(process.env.SEO_PLATFORM_E2E_CONFIRM, "CREATE_TEST_DATA");
const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
assert.ok(base?.startsWith("https://144.31.221.28:3000"));
const fixtures = JSON.parse(await readFile(process.env.SEO_PLATFORM_SESSION_FIXTURES, "utf8"));
const project = JSON.parse(await readFile(output + "/usability-project.json", "utf8"));
const browser = await chromium.launch({ headless: true });
let ownerState = fixtures[0].storageState;
try { ownerState = JSON.parse(await readFile(output + "/usability-owner.json", "utf8")); } catch { /* Initial fixtures also support a standalone audit. */ }
const owner = await browser.newContext({ storageState: ownerState });
await owner.addCookies([{ name: "seo_workspace", value: project.workspaceId, url: base }, { name: "seo_project", value: project.projectId, url: base }]);
const staff = await browser.newContext({ storageState: fixtures.find(item => item.role === "SUPER_ADMIN").storageState });
const anonymous = await browser.newContext();
const routes = [
  ...["/app", "/app/projects", "/app/semantics", "/app/rankings", "/app/competitors", "/app/tasks", "/app/notifications", "/app/tools"].map(path => ({ path, context: owner })),
  ...["workspace", "security", "billing", "integrations", "team", "roles", "api", "notifications", "projects"].map(section => ({ path: "/app/settings/" + section, context: owner })),
  ...["pages", "notes", "rankings/contexts", "rankings/automations", "tools/serp", "tools/http-status-checker", "settings/general", "settings/integrations", "settings/notifications"].map(section => ({ path: `/app/projects/${project.projectId}/` + section, context: owner })),
  ...["overview", "analytics", "workspaces", "projects", "operations", "workers", "receipts", "staff", "refunds", "providers", "usage"].map(screen => ({ path: "/admin?screen=" + screen, context: staff })),
  ...["/ru", "/en", "/pricing", "/help", "/docs/api", "/tools", "/security"].map(path => ({ path, context: owner })),
  ...["/app/login", "/app/register", "/app/forgot-password", "/app/reset-password", "/app/verify-email"].map(path => ({ path, context: anonymous })),
];
const fromIndex = Number(process.env.SEO_PLATFORM_AUDIT_FROM ?? 0);
const toIndex = Number(process.env.SEO_PLATFORM_AUDIT_TO ?? routes.length);
assert.ok(Number.isSafeInteger(fromIndex) && Number.isSafeInteger(toIndex) && fromIndex >= 0 && toIndex <= routes.length && toIndex > fromIndex);
const results = [];
try {
  const queue = routes.slice(fromIndex, toIndex);
  await Promise.all(Array.from({ length: 1 }, async () => {
  let route;
  while ((route = queue.shift())) {
    const page = await route.context.newPage();
    const pageErrors = [], serverErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => {
      if (response.status() >= 500 && new URL(response.url()).origin === base) serverErrors.push({
        path: new URL(response.url()).pathname, status: response.status(),
        requestId: response.headers()["x-request-id"],
        prefetch: response.request().headers()["next-router-prefetch"] ?? response.request().headers()["purpose"] ?? null
      });
    });
    for (const width of [1440, 768, 390, 320]) {
      pageErrors.length = 0; serverErrors.length = 0;
      await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 });
      const before = performance.now();
      const response = await page.goto(base + route.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (route.path.startsWith("/app") && route.context !== anonymous) await page.locator(".app-shell").waitFor({ timeout: 15_000 });
      if (route.path.startsWith("/admin")) await page.locator(".admin-shell").waitFor({ timeout: 15_000 });
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
      if (route.path === "/app/semantics") await page.locator(".semantic-table tbody tr").first().waitFor({ timeout: 15_000 });
      if (route.path === "/app/rankings") await page.locator(".rankings-matrix tbody tr").first().waitFor({ timeout: 15_000 });
      if (route.context !== anonymous) assert.ok(!page.url().includes("login"), "Audit must inspect the requested authenticated screen, not the login page");
      const metrics = await page.evaluate(() => {
        const visible = element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && style.visibility !== "hidden" && style.display !== "none";
        };
        const controls = [...document.querySelectorAll('button,a[href],[role="button"],[role="combobox"],input,select,textarea')].filter(visible);
        const unnamed = controls.filter(element => {
          if (element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("aria-labelledby")) return false;
          if (element.labels?.length || element.closest("label")) return false;
          return !element.textContent.trim();
        });
        const smallTargets = controls.filter(element => { const rect = element.getBoundingClientRect(); return rect.width < 24 || rect.height < 24; });
        const smallText = [...document.querySelectorAll('p,label,small,dt,dd,th,td,button,a,strong,span')].filter(element => visible(element) && element.children.length === 0 && element.textContent.trim() && parseFloat(getComputedStyle(element).fontSize) < 11);
        return {
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          bodyRows: document.querySelectorAll("tbody tr").length,
          visibleControls: controls.length, unnamedControls: unnamed.length,
          smallTargets: smallTargets.length, smallText: smallText.length,
          headingLevels: [...document.querySelectorAll("h1,h2,h3")].map(element => element.tagName),
          sampleUnnamedClasses: unnamed.slice(0, 8).map(element => element.className),
          sampleSmallClasses: smallTargets.slice(0, 8).map(element => element.className),
          unavailable: document.body.textContent.includes("Сервис данных временно недоступен"),
        };
      });
      results.push({ path: route.path.replace(project.projectId, ":projectId"), width, status: response?.status(), elapsedMs: Math.round(performance.now() - before), ...metrics, pageErrors: [...pageErrors], serverErrors: [...serverErrors] });
      await writeFile(output + "/audit-result-" + routes.indexOf(route) + "-" + width + ".json", JSON.stringify(results.at(-1)), { mode: 0o600 });
      if (["/app/semantics", "/app/rankings", "/app/settings/integrations", "/app/settings/billing", "/app/projects", "/admin?screen=analytics"].includes(route.path) && [1440, 390].includes(width)) {
        await page.screenshot({ path: output + "/audit-" + route.path.replace(/[^a-z0-9]+/giu, "-") + "-" + width + ".png", fullPage: true });
      }
    }
    await page.close();
  }
  }));
} finally { await browser.close(); }
await writeFile(output + `/usability-audit-${fromIndex}-${toIndex}.json`, JSON.stringify(results, null, 2), { mode: 0o600 });
const totals = {
  screens: toIndex - fromIndex, viewports: results.length,
  failures: results.filter(row => row.status >= 400 || row.pageErrors.length || row.serverErrors.length || row.unavailable).map(row => ({ path: row.path, width: row.width, status: row.status, errors: row.pageErrors.length + row.serverErrors.length })),
  overflow: results.filter(row => row.documentWidth > row.viewport + 1).map(row => ({ path: row.path, width: row.width, extra: row.documentWidth - row.viewport })),
};
console.log(JSON.stringify(totals));
assert.equal(totals.failures.length, 0, "Requested screens must load without API, JS or data-service errors");
assert.equal(totals.overflow.length, 0, "Only bounded table viewports may scroll horizontally, not the page");
