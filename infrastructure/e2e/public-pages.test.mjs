import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
const base = process.env.SEO_PLATFORM_PUBLIC_URL, output = process.env.SEO_PLATFORM_E2E_OUTPUT_DIR;
test("public RU/EN pages through Caddy: real catalog, document links, language and separate consents", { skip: !base || !output, timeout: 180_000 }, async t => {
  assert.ok(base.startsWith("https://")); await mkdir(output, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true }); t.after(async () => browser.close());
  const page = await browser.newPage(), errors = []; page.on("pageerror", error => errors.push(error.name));
  for (const locale of ["ru", "en"]) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const slug of ["pricing", "terms", "privacy", "data-consent", "refunds", "cookies", "security", "help"]) {
        const response = await page.goto(`${base}/${locale}/${slug}`, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, `${locale}/${slug}`);
        assert.equal(await page.locator("html").getAttribute("lang"), locale, "Server document locale");
        assert.equal(await page.locator("h1").count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${slug} overflows ${width}`);
        if (slug === "pricing") {
          assert.equal(await page.locator(".public-price-card").count(), 4, "Plans come from the live Core catalog");
          assert.equal(await page.locator(".public-document-draft").count(), 0);
        }
        if (["terms", "privacy", "data-consent", "refunds"].includes(slug)) {
          assert.equal(await page.locator('.public-document-draft').count(), 1, "Unpublished profile must remain a review draft");
          assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/u);
        }
        if (["pricing", "terms"].includes(slug)) await page.screenshot({ path: path.join(output, `${locale}-${slug}-${width}.png`), fullPage: true });
      }
    }
  }
  await page.goto(`${base}/app/register?locale=en`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  for (const name of ["termsAccepted", "privacyAccepted", "marketingAccepted"]) assert.equal(await page.locator(`input[name="${name}"]`).isChecked(), false);
  assert.equal(await page.locator('input[name="privacyAccepted"]').getAttribute("required"), "");
  assert.equal(await page.locator('input[name="marketingAccepted"]').getAttribute("required"), null);
  await page.goto(`${base}/privacy`, { waitUntil: "networkidle" });
  assert.equal(new URL(page.url()).pathname, "/en/privacy");
  assert.deepEqual(errors, []);
});
