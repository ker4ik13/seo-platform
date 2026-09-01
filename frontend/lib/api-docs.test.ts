import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  apiDocHref,
  apiDocSection,
  apiDocSections,
  apiDocSectionsByGroup,
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
  assert.ok(apiEndpointCatalog.length >= 50);
  for (const endpoint of apiEndpointCatalog) {
    assert.match(endpoint.id, /^[a-z][a-z0-9-]+$/);
    assert.match(endpoint.path, /^\//);
    assert.doesNotMatch(endpoint.path, /\/(?:admin|internal)(?:\/|$)/);
    assert.ok(sectionSlugs.has(endpoint.section));
    assert.ok(endpoint.scope.includes(":"));
    assert.ok(endpoint.description.length > 3);
  }
});

test("documents identifier-free access discovery for API agents", () => {
  const discovery = apiEndpointCatalog.find(
    ({ id }) => id === "access-discovery"
  );

  assert.deepEqual(discovery, {
    id: "access-discovery",
    method: "GET",
    path: "/access",
    scope: "token:discover",
    description: "Рабочая область, проекты и права текущего API-ключа",
    section: "quick-start"
  });
});

test("documents keyword and group deletion as stable public routes", () => {
  const deletionEndpoints = apiEndpointCatalog.filter(({ id }) =>
    ["group-delete", "keyword-delete"].includes(id)
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

test("sidebar groups preserve every section exactly once", () => {
  const groupedSections = apiDocSectionsByGroup().flatMap(
    ({ sections }) => sections
  );

  assert.deepEqual(groupedSections, [...apiDocSections]);
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
