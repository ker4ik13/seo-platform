import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("frontend is one Next.js deployable with the protected admin route", async () => {
  const [compose, dockerfile, adminPage, adminProxy] = await Promise.all([
    infrastructureFile("compose.dokploy.yml"),
    infrastructureFile("docker/web.Dockerfile"),
    workspaceFile("frontend/app/admin/page.tsx"),
    workspaceFile("frontend/app/admin/api/[...path]/route.ts")
  ]);
  const frontend = serviceBlock(compose, "frontend");
  const build = nestedBlock(frontend, "build");

  assert.match(build, /PACKAGE_NAME: "@seo-platform\/frontend"/u);
  assert.match(build, /PACKAGE_PATH: frontend/u);
  assert.match(
    build,
    /NEXT_PUBLIC_SITE_URL: \$\{WEB_PUBLIC_URL:\?WEB_PUBLIC_URL is required\}/u
  );
  assert.match(frontend, /^      - internal$/mu);
  assert.match(frontend, /^      - edge$/mu);
  assert.doesNotMatch(frontend, /^    ports:/mu);
  assert.match(adminPage, /AdminApp/u);
  assert.match(adminProxy, /proxyAdminApi/u);
  assert.doesNotMatch(compose, /^  admin:$/mu);
  assert.match(dockerfile, /ARG NEXT_PUBLIC_SITE_URL/u);
  assert.match(
    dockerfile,
    /ENV NEXT_PUBLIC_SITE_URL=\$NEXT_PUBLIC_SITE_URL/u
  );
});

test("only three application deployables are present", async () => {
  const compose = await infrastructureFile("compose.dokploy.yml");
  for (const service of ["frontend", "backend-core", "backend-execution"]) {
    assert.match(compose, new RegExp(`^  ${service}:$`, "mu"));
  }
  assert.equal(
    [...compose.matchAll(
      /^  (frontend|backend-core|backend-execution):$/gmu
    )].length,
    3
  );
  assert.match(
    nestedBlock(serviceBlock(compose, "backend-core"), "environment"),
    /CORS_ORIGINS: \$\{WEB_PUBLIC_URL:\?WEB_PUBLIC_URL is required\}/u
  );
});

async function infrastructureFile(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function workspaceFile(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function serviceBlock(compose, serviceName) {
  const lines = compose.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `${serviceName} service must exist`);
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^  [a-z0-9][a-z0-9-]*:\s*$/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function nestedBlock(service, key) {
  const lines = service.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `    ${key}:`);
  assert.notEqual(start, -1, `${key} block must exist`);
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^    [a-z_][a-z0-9_-]*:/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}
