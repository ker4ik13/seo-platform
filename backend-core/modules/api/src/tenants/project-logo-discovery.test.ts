import assert from "node:assert/strict";
import test from "node:test";
import { htmlIconCandidates } from "./project-logo-discovery.js";

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
