import assert from "node:assert/strict";
import test from "node:test";
import { robotsAllows, createRobotsPolicy } from "./robots.js";

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

test("equal-length Allow wins regardless of source order", () => {
  assert.equal(robotsAllows("User-agent: *\nDisallow: /page\nAllow: /page", new URL("https://example.com/page")), true);
});
test("compiled robot scope uses YandexBot specifics and normalizes UTF-8/unreserved escapes", () => {
  const policy = createRobotsPolicy("User-agent: *\nAllow: /\nUser-agent: Yandex\nAllow: /\nUser-agent: YandexBot\nDisallow: /медведь\nDisallow: /test%61");
  assert.equal(policy.access(new URL("https://example.com/медведь"), "yandexbot").allowed, false);
  assert.equal(policy.access(new URL("https://example.com/testa"), "yandexbot").allowed, false);
  assert.equal(policy.access(new URL("https://example.com/медведь"), "googlebot").allowed, true);
});
test("long wildcard sequences cannot trigger regular-expression backtracking", () => {
  const policy = createRobotsPolicy(`User-agent: *\nDisallow: /${"a*".repeat(400)}z$`);
  assert.equal(policy.access(new URL(`https://example.com/${"a".repeat(500)}x`)).allowed, true);
});
