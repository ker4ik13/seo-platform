import assert from "node:assert/strict";
import test from "node:test";
import type { AppWorkspace } from "./app-types.ts";
import { parseSearchProjects, searchTenantCatalog } from "./global-search.ts";

const workspace: AppWorkspace = { id: "area", name: "Студия", slug: "studio", locale: "ru", timezone: "UTC", status: "ACTIVE", roleCode: "OWNER", version: 1, owner: { userId: "user", displayName: "Иван Петров", email: "ivan@example.org" } };
test("search groups accessible workspaces with owners and projects with domains", () => {
  const projects = [{ id: "p", workspaceId: "area", name: "Дом", domain: "dom.example.org", version: 1 }, { id: "foreign", workspaceId: "other", name: "Дом", domain: "dom.example.org", version: 1 }];
  assert.deepEqual(searchTenantCatalog([workspace], projects, "ИВАН").workspaces, [workspace]);
  assert.equal(searchTenantCatalog([workspace], projects, "ivan@EXAMPLE").workspaces.length, 1);
  assert.deepEqual(searchTenantCatalog([workspace], projects, "dom.example").projects.map(({ id }) => id), ["p"]);
  assert.equal(searchTenantCatalog([workspace], projects, "Студия Дом").projects.length, 1);
  assert.equal(searchTenantCatalog([], projects, "").projects.length, 0);
});
test("catalog parser rejects projects outside the requested workspace", () => {
  assert.throws(() => parseSearchProjects([{ id: "p", workspaceId: "other", name: "x", domain: "x.org", version: 1 }], "area"));
  assert.throws(() => parseSearchProjects({}, "area"));
});
