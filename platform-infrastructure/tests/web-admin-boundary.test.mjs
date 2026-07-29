import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredPublicUrlAssignment =
  "        NEXT_PUBLIC_SITE_URL: ${WEB_PUBLIC_URL:?WEB_PUBLIC_URL is required}";
const requiredApiOriginAssignment =
  "      CORS_ORIGINS: ${WEB_PUBLIC_URL:?WEB_PUBLIC_URL is required}";
const requiredRealtimeOriginAssignment =
  "      WEB_ORIGINS: ${WEB_PUBLIC_URL:?WEB_PUBLIC_URL is required}";

test("web build embeds the required public site URL before Next.js build", async () => {
  const compose = await infrastructureFile("compose.dokploy.yml");
  const dockerfile = await infrastructureFile("docker/web.Dockerfile");
  const webBuild = nestedBlock(serviceBlock(compose, "web"), "build");
  const adminBuild = nestedBlock(serviceBlock(compose, "admin"), "build");

  assert.ok(
    webBuild.split(/\r?\n/u).includes(requiredPublicUrlAssignment),
    "web build must require WEB_PUBLIC_URL as NEXT_PUBLIC_SITE_URL"
  );
  assert.doesNotMatch(
    adminBuild,
    /\b(?:NEXT_PUBLIC_SITE_URL|WEB_PUBLIC_URL)\b/u,
    "admin build must not receive the public Web origin"
  );

  const dockerfileLines = dockerfile.split(/\r?\n/u);
  const argIndex = dockerfileLines.indexOf("ARG NEXT_PUBLIC_SITE_URL");
  const envIndex = dockerfileLines.indexOf(
    "ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL"
  );
  const buildIndex = dockerfileLines.findIndex((line) =>
    line.startsWith('RUN pnpm --filter "$TARGET_PACKAGE" build')
  );

  assert.notEqual(argIndex, -1, "Web Dockerfile must declare the build arg");
  assert.notEqual(envIndex, -1, "Web Dockerfile must export the build arg");
  assert.notEqual(buildIndex, -1, "Web Dockerfile must run the package build");
  assert.ok(
    argIndex < envIndex && envIndex < buildIndex,
    "NEXT_PUBLIC_SITE_URL must be available in the environment before pnpm build"
  );
});

test("admin stays internal-only while web remains attached to edge", async () => {
  const compose = await infrastructureFile("compose.dokploy.yml");
  const web = serviceBlock(compose, "web");
  const admin = serviceBlock(compose, "admin");

  assert.deepEqual(networkNames(nestedBlock(web, "networks")), [
    "internal",
    "edge"
  ]);
  assert.deepEqual(
    networkNames(nestedBlock(admin, "networks")),
    ["internal"],
    "unauthenticated admin shell must not have an edge route"
  );
  assert.doesNotMatch(
    admin,
    /^    ports:/mu,
    "admin must not publish a host port"
  );
});

test("admin origin is absent from external browser allowlists", async () => {
  const compose = await infrastructureFile("compose.dokploy.yml");
  const apiEnvironment = nestedBlock(
    serviceBlock(compose, "platform-api"),
    "environment"
  );
  const realtimeEnvironment = nestedBlock(
    serviceBlock(compose, "realtime"),
    "environment"
  );
  const rootExample = await workspaceFile(".env.example");
  const apiExample = await workspaceFile("platform-api/.env.example");
  const realtimeExample = await workspaceFile(
    "platform-realtime/.env.example"
  );

  assert.ok(
    apiEnvironment.split(/\r?\n/u).includes(requiredApiOriginAssignment),
    "Platform API CORS must require only the public Web origin"
  );
  assert.ok(
    realtimeEnvironment
      .split(/\r?\n/u)
      .includes(requiredRealtimeOriginAssignment),
    "Realtime Web origins must require only the public Web origin"
  );

  for (const [name, contents] of [
    ["Compose", compose],
    ["root env example", rootExample],
    ["Platform API env example", apiExample],
    ["Realtime env example", realtimeExample]
  ]) {
    assert.doesNotMatch(
      contents,
      /ADMIN_PUBLIC_URL|admin\.example|localhost:3002/u,
      `${name} must not allow the unauthenticated Admin origin`
    );
  }

  assert.match(apiExample, /^CORS_ORIGINS=https:\/\/example\.com$/mu);
  assert.match(realtimeExample, /^WEB_ORIGINS=http:\/\/localhost:3000$/mu);
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

function networkNames(networkBlock) {
  return [...networkBlock.matchAll(/^      - ([a-z0-9-]+)$/gmu)].map(
    (match) => match[1]
  );
}
