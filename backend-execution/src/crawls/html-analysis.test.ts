import assert from "node:assert/strict";
import test from "node:test";
import { analyzeHtmlPage } from "./html-analysis.js";

test("extracts normalized SEO evidence without retaining raw HTML", () => {
  const result = analyzeHtmlPage({
    finalUrl: "https://example.com/service/",
    statusCode: 200,
    responseTimeMs: 320,
    sizeBytes: 1_200,
    html: `<!doctype html>
      <html lang="ru">
        <head>
          <title>Полное название полезной страницы услуги</title>
          <meta name="description" content="Описание страницы">
          <meta name="robots" content="index, follow">
          <link rel="canonical" href="/service/">
          <link rel="alternate" hreflang="en" href="/en/service/">
          <script type="application/ld+json">{"@type":"Service"}</script>
        </head>
        <body>
          <h1>Услуга</h1><h2>Подробности</h2>
          <a href="/about">О компании</a>
          <a href="https://outside.example/path">Внешняя</a>
          <img src="/hero.jpg"><img src="/ok.jpg" alt="Фото">
          ${"полезный текст ".repeat(110)}
        </body>
      </html>`
  });

  assert.equal(result.title, "Полное название полезной страницы услуги");
  assert.equal(result.h1, "Услуга");
  assert.equal(result.h1Count, 1);
  assert.equal(result.indexability, "INDEXABLE");
  assert.deepEqual(result.internalLinks, ["https://example.com/about"]);
  assert.deepEqual(result.externalLinks, ["https://outside.example/path"]);
  assert.deepEqual(result.structuredDataTypes, ["Service"]);
  assert.deepEqual(result.metaTags, [
    { name: "description", content: "Описание страницы" },
    { name: "robots", content: "index, follow" }
  ]);
  assert.equal(result.imagesMissingAlt, 1);
  assert.match(result.contentHash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    result.issues.map(({ code }) => code),
    ["IMAGE_ALT_MISSING"]
  );
  assert.equal("html" in result, false);
});

test("detects blocking and on-page audit issues deterministically", () => {
  const result = analyzeHtmlPage({
    finalUrl: "https://example.com/a",
    statusCode: 200,
    responseTimeMs: 4_000,
    sizeBytes: 1_600_000,
    html: `<html><head>
      <title>Short</title>
      <meta name="robots" content="noindex">
      <link rel="canonical" href="/other">
    </head><body><h1>One</h1><h1>Two</h1></body></html>`
  });
  const codes = result.issues.map(({ code }) => code);
  for (const expected of [
    "TITLE_SHORT",
    "DESCRIPTION_MISSING",
    "H1_MULTIPLE",
    "NOINDEX",
    "THIN_CONTENT",
    "SLOW_RESPONSE",
    "HTML_TOO_LARGE"
  ]) {
    assert.ok(codes.includes(expected), expected);
  }
  assert.equal(result.indexability, "NOINDEX");
});
