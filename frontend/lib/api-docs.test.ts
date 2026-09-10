import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  apiDocHref,
  apiDocSection,
  apiDocSections,
  apiDocSectionsByGroup,
  apiAgentCatalog,
  apiEndpointCatalog
} from "./api-docs.ts";

test("keeps documentation sections addressable and uniquely ordered", () => {
  const slugs = apiDocSections.map(({ slug }) => slug);

  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(apiDocHref("quick-start"), "/docs/api");
  for (const section of apiDocSections) {
    assert.equal(apiDocSection(section.slug), section);
    assert.equal(
      apiDocHref(section.slug),
      section.slug === "quick-start"
        ? "/docs/api"
        : `/docs/api/${section.slug}`
    );
  }
  assert.equal(apiDocSection("unknown-section"), undefined);
});

test("catalog contains only public, searchable and valid API routes", () => {
  const sectionSlugs = new Set(apiDocSections.map(({ slug }) => slug));
  const endpointIds = apiEndpointCatalog.map(({ id }) => id);

  assert.equal(new Set(endpointIds).size, endpointIds.length);
  assert.ok(apiEndpointCatalog.length >= 180);
  for (const endpoint of apiEndpointCatalog) {
    assert.match(endpoint.id, /^[a-z][a-z0-9-]+$/);
    assert.match(endpoint.path, /^\//);
    assert.doesNotMatch(endpoint.path, /\/(?:admin|internal)(?:\/|$)/);
    assert.ok(sectionSlugs.has(endpoint.section));
    assert.ok(endpoint.scope.includes(":"));
    assert.ok(endpoint.description.length > 3);
    assert.ok(endpoint.requestFormat.length > 10);
    assert.ok(endpoint.responseFormat.length > 10);
  }
});

test("documents identifier-free access discovery for API agents", () => {
  const discovery = apiEndpointCatalog.find(
    ({ id }) => id === "access-discovery"
  );

  assert.deepEqual(discovery && {
    id: discovery.id,
    method: discovery.method,
    path: discovery.path,
    scope: discovery.scope,
    description: discovery.description,
    section: discovery.section
  }, {
    id: "access-discovery",
    method: "GET",
    path: "/access",
    scope: "token:discover",
    description: "Рабочая область, проекты и права текущего API-ключа",
    section: "quick-start"
  });
});

test("documents keyword and group deletion as stable public routes", () => {
  const deletionEndpoints = apiEndpointCatalog
    .filter(({ id }) => ["group-delete", "keyword-delete"].includes(id))
    .map(({ requestFormat: _request, responseFormat: _response, ...endpoint }) =>
      endpoint
    );

  assert.deepEqual(deletionEndpoints, [
    {
      id: "group-delete",
      method: "DELETE",
      path: "/projects/{projectId}/keyword-groups/{groupId}",
      scope: "semantics:write",
      description: "Удалить папку с выбранной стратегией для дочерних папок и запросов",
      section: "semantics"
    },
    {
      id: "keyword-delete",
      method: "DELETE",
      path: "/projects/{projectId}/keywords/{keywordId}",
      scope: "semantics:write",
      description: "Переместить запрос в корзину или окончательно очистить его данные",
      section: "semantics"
    }
  ]);
});

test("documents notes, group colors and complete rank workbench data for API agents", () => {
  const byId = new Map(apiEndpointCatalog.map((endpoint) => [endpoint.id, endpoint]));
  assert.match(byId.get("notes")?.responseFormat ?? "", /markdown/iu);
  assert.match(byId.get("groups-list")?.responseFormat ?? "", /color/iu);
  assert.match(byId.get("group-color-legend")?.responseFormat ?? "", /note/iu);
  assert.equal(byId.get("rank-workbench-positions")?.scope, "positions:read");
  assert.match(
    byId.get("rank-workbench-serp")?.responseFormat ?? "",
    /snapshots.*aiSnapshots/iu
  );
  assert.match(byId.get("operation-estimate")?.requestFormat ?? "", /kind/iu);
});

test("catalog covers every durable project controller route available to API tokens", async () => {
  const apiRoot = new URL("../../backend-core/modules/api/src/", import.meta.url);
  const files = await controllerFiles(apiRoot);
  const documented = new Set(
    apiEndpointCatalog.map(({ method, path }) => `${method} ${path}`)
  );
  const sessionOnly = new Set([
    "GET /projects/{projectId}/presence-members",
    "GET /projects/{projectId}/presence-members/{userId}/avatar",
    "POST /projects/{projectId}/realtime-tickets",
    "GET /projects/{projectId}/notification-subscription",
    "PATCH /projects/{projectId}/notification-subscription"
  ]);
  const missing: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const controllers = [
      ...source.matchAll(/@Controller\("([^"]+)"\)/gu)
    ];
    for (const [index, controller] of controllers.entries()) {
      const prefix = controller[1];
      if (
        !prefix ||
        (!prefix.startsWith("api/v1/projects/:projectId") &&
          !prefix.startsWith("api/v1/workspaces/:workspaceId/integrations"))
      ) {
        continue;
      }
      const body = source.slice(
        (controller.index ?? 0) + controller[0].length,
        controllers[index + 1]?.index ?? source.length
      );
      for (const route of body.matchAll(
        /@(Get|Post|Put|Patch|Delete)\((?:"([^"]*)")?\)/gu
      )) {
        const method = route[1]?.toUpperCase();
        const suffix = route[2] ?? "";
        if (!method) continue;
        const path = `/${[prefix.slice("api/v1/".length), suffix]
          .filter(Boolean)
          .join("/")}`.replace(/:([A-Za-z][A-Za-z0-9]*)/gu, "{$1}");
        const key = `${method} ${path}`;
        if (!sessionOnly.has(key) && !documented.has(key)) missing.push(key);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("sidebar groups preserve every section exactly once", () => {
  const groupedSections = apiDocSectionsByGroup().flatMap(
    ({ sections }) => sections
  );

  assert.deepEqual(groupedSections, [...apiDocSections]);
});

test("builds one secret-free machine-readable catalog for an API agent", () => {
  const catalog = apiAgentCatalog("https://api.example.test/api/v1");
  assert.equal(catalog.apiVersion, "v1");
  assert.equal(catalog.baseUrl, "https://api.example.test/api/v1");
  assert.equal(
    catalog.sections.flatMap(({ endpoints }) => endpoints).length,
    apiEndpointCatalog.length
  );
  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /\/internal\/|\/admin\//u);
  assert.match(serialized, /seo_pat_<secret>/u);
});

test("documentation source never bakes a deployment IP into examples", () => {
  const documentationSource = readFileSync(
    new URL("../components/api-documentation.tsx", import.meta.url),
    "utf8"
  );
  const routeSource = readFileSync(
    new URL("../app/docs/api/page.tsx", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(documentationSource, /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/u);
  assert.match(routeSource, /apiPublicOrigin\(\)/u);
});

async function controllerFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await controllerFiles(target));
    else if (entry.name.endsWith(".controller.ts")) files.push(target);
  }
  return files;
}
