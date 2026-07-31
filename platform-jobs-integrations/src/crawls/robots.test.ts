import assert from "node:assert/strict";
import test from "node:test";
import { robotsAllows } from "./robots.js";

test("honors the most specific matching robots group and allow rule", () => {
  const source = `
    User-agent: *
    Disallow: /private
    Allow: /private/public

    User-agent: SeoPlatformCrawler
    Disallow: /crawler-only
  `;
  assert.equal(
    robotsAllows(source, new URL("https://example.com/private")),
    true
  );
  assert.equal(
    robotsAllows(source, new URL("https://example.com/crawler-only/a")),
    false
  );
});

test("uses wildcard rules and longest-match precedence", () => {
  const source = `
    User-agent: *
    Disallow: /files/*
    Allow: /files/public$
  `;
  assert.equal(
    robotsAllows(source, new URL("https://example.com/files/private")),
    false
  );
  assert.equal(
    robotsAllows(source, new URL("https://example.com/files/public")),
    true
  );
});
