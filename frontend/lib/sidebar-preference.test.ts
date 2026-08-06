import assert from "node:assert/strict";
import test from "node:test";
import { sidebarCollapsedFromCookie } from "./sidebar-preference.ts";

test("accepts only the explicit collapsed sidebar cookie", () => {
  assert.equal(sidebarCollapsedFromCookie("1"), true);
  assert.equal(sidebarCollapsedFromCookie("0"), false);
  assert.equal(sidebarCollapsedFromCookie("true"), false);
  assert.equal(sidebarCollapsedFromCookie(undefined), false);
});
