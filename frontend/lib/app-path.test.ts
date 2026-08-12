import assert from "node:assert/strict";
import test from "node:test";
import {
  externalPageUrlPresentation,
  isSafeBrowserApiPath,
  projectLogoUrl,
  safeAppReturnTo,
  semanticExportFileUrl
} from "./app-path.ts";

test("accepts only local app return paths", () => {
  assert.equal(safeAppReturnTo("/app/tools"), "/app/tools");
  assert.equal(safeAppReturnTo("https://example.com"), "/app");
  assert.equal(safeAppReturnTo("//example.com/app"), "/app");
  assert.equal(
    safeAppReturnTo("/app/auth/refresh?returnTo=/app"),
    "/app"
  );
});

test("rejects path traversal and encoded browser API segments", () => {
  assert.equal(isSafeBrowserApiPath(["workspaces", "valid-id"]), true);
  assert.equal(
    isSafeBrowserApiPath(["integrations", "routing", "SERP_RANK_TRACKING"]),
    true
  );
  assert.equal(isSafeBrowserApiPath([]), false);
  assert.equal(isSafeBrowserApiPath(["..", "internal"]), false);
  assert.equal(isSafeBrowserApiPath(["auth", "login?admin=true"]), false);
});

test("presents an external ranking URL as a clickable path without its domain", () => {
  assert.deepEqual(
    externalPageUrlPresentation(
      "https://example.com/catalog/page?region=213#offers"
    ),
    {
      href: "https://example.com/catalog/page?region=213#offers",
      label: "/catalog/page?region=213#offers"
    }
  );
  assert.deepEqual(externalPageUrlPresentation("https://example.com"), {
    href: "https://example.com/",
    label: "/"
  });
  assert.equal(
    externalPageUrlPresentation("javascript:alert(document.cookie)"),
    undefined
  );
  assert.equal(externalPageUrlPresentation("not a URL"), undefined);
});

test("builds a same-origin versioned project logo URL", () => {
  assert.equal(
    projectLogoUrl("01900000-0000-7000-8000-000000000101", 12),
    "/app/api/projects/01900000-0000-7000-8000-000000000101/logo?v=12"
  );
});

test("builds a same-origin semantic export download URL", () => {
  assert.equal(
    semanticExportFileUrl(
      "01900000-0000-7000-8000-000000000101",
      "01900000-0000-7000-8000-000000000102"
    ),
    "/app/api/projects/01900000-0000-7000-8000-000000000101/exports/01900000-0000-7000-8000-000000000102/file"
  );
});
