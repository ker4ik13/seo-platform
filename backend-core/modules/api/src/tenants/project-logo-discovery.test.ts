import assert from "node:assert/strict";
import test from "node:test";
import { htmlIconCandidates, rankedLogoCandidates } from "./project-logo-discovery.js";

test("collects absolute icon candidates with declared quality hints", () => {
  const candidates = htmlIconCandidates(
    `
      <link rel="icon" type="image/png" sizes="32x32 512x512" href="/icons/app.png?rev=2">
      <link href="assets/mark.svg" sizes="any" rel="mask-icon">
      <link rel="stylesheet" href="/not-an-icon.css">
    `,
    "https://example.org/catalog/"
  );
  assert.deepEqual(candidates, [
    {
      url: "https://example.org/icons/app.png?rev=2",
      declaredPixels: 262_144,
      vectorHint: false,
      priority: 100
    },
    {
      url: "https://example.org/catalog/assets/mark.svg",
      declaredPixels: 0,
      vectorHint: true,
      priority: 60
    }
  ]);
});

test("ignores non-http and malformed icon references", () => {
  assert.deepEqual(
    htmlIconCandidates(
      '<link rel="icon" href="data:image/svg+xml,unsafe"><link rel="icon" href="javascript:alert(1)">',
      "https://example.org/"
    ),
    []
  );
});

test("never evicts root ICO when higher-resolution guesses exhaust the budget", () => {
  const guessed = Array.from({ length: 40 }, (_, index) => ({ url: `https://example.org/icon-${index}.png`, declaredPixels: 262144, vectorHint: false, priority: 90 }));
  const ico = { url: "https://example.org/favicon.ico", declaredPixels: 0, vectorHint: false, priority: 40 };
  const ranked = rankedLogoCandidates([...guessed, ico]);
  assert.equal(ranked.length, 24);
  assert.equal(ranked[1]?.url, ico.url, "root ICO must be checked in the first batch");
});
