import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("frontend is one Next.js deployable with the protected admin route", async () => {
  const [compose, dockerfile, frontendPackageSource, adminPage, adminProxy, frontendServer] = await Promise.all([
    infrastructureFile("compose.dokploy.yml"),
    infrastructureFile("docker/web.Dockerfile"),
    workspaceFile("frontend/package.json"),
    workspaceFile("frontend/app/admin/page.tsx"),
    workspaceFile("frontend/app/admin/api/[...path]/route.ts"),
    workspaceFile("frontend/server.mjs")
  ]);
  const frontendPackage = JSON.parse(frontendPackageSource);
  const frontend = serviceBlock(compose, "frontend");
  const build = nestedBlock(frontend, "build");

  assert.match(build, /PACKAGE_NAME: "@seo-platform\/frontend"/u);
  assert.match(build, /PACKAGE_PATH: frontend/u);
  assert.match(
    build,
    /WEB_PUBLIC_URL: \$\{WEB_PUBLIC_URL:\?WEB_PUBLIC_URL is required\}/u
  );
  assert.match(
    build,
    /WEB_WWW_REDIRECT_HOST: \$\{WEB_WWW_REDIRECT_HOST:-www\.seonorita\.ru\}/u
  );
  assert.match(
    frontend,
    /WEB_WWW_REDIRECT_HOST: \$\{WEB_WWW_REDIRECT_HOST:-www\.seonorita\.ru\}/u
  );
  assert.match(build, /REALTIME_INTERNAL_URL: http:\/\/backend-core:4003/u);
  assert.match(frontend, /REALTIME_INTERNAL_URL: http:\/\/backend-core:4003/u);
  assert.match(frontend, /^      - internal$/mu);
  assert.match(frontend, /^      - edge$/mu);
  assert.doesNotMatch(frontend, /^    ports:/mu);
  assert.match(adminPage, /AdminApp/u);
  assert.match(adminProxy, /proxyAdminApi/u);
  assert.doesNotMatch(compose, /^  admin:$/mu);
  assert.match(dockerfile, /ARG WEB_PUBLIC_URL/u);
  assert.match(
    dockerfile,
    /ENV WEB_PUBLIC_URL=\$WEB_PUBLIC_URL/u
  );
  assert.match(dockerfile, /ARG WEB_WWW_REDIRECT_HOST/u);
  assert.match(
    dockerfile,
    /ENV WEB_WWW_REDIRECT_HOST=\$WEB_WWW_REDIRECT_HOST/u
  );
  assert.match(dockerfile, /ARG REALTIME_INTERNAL_URL/u);
  assert.match(
    dockerfile,
    /ENV REALTIME_INTERNAL_URL=\$REALTIME_INTERNAL_URL/u
  );
  assert.ok(
    dockerfile.indexOf("pnpm --filter @seo-platform/contracts build") <
      dockerfile.indexOf('pnpm --filter "$TARGET_PACKAGE" build'),
    "the clean Docker build must compile contracts before Next.js"
  );
  assert.ok(
    dockerfile.indexOf(
      "pnpm --filter @seo-platform/operational-alerts build"
    ) < dockerfile.indexOf('pnpm --filter "$TARGET_PACKAGE" deploy'),
    "the clean Docker build must compile runtime workspace packages before deploy"
  );
  assert.equal(
    frontendPackage.dependencies?.["@seo-platform/contracts"],
    "workspace:*"
  );
  assert.equal(
    frontendPackage.dependencies?.["@seo-platform/operational-alerts"],
    "workspace:*"
  );
  assert.equal(
    frontendPackage.devDependencies?.["@seo-platform/contracts"],
    undefined
  );
  assert.equal(frontendPackage.dependencies?.["socket.io-client"], "4.8.3");
  assert.equal(frontendPackage.scripts?.start, "node server.mjs");
  assert.match(frontendServer, /app\.getUpgradeHandler\(\)/u);
  assert.match(frontendServer, /REALTIME_PATH = "\/socket\.io\/"/u);
  assert.match(frontendServer, /realtimeInternalOrigin\(env\)/u);
  assert.match(frontendServer, /delete headers\.cookie/u);
  assert.match(frontendServer, /delete headers\.forwarded/u);
  assert.match(frontendServer, /upstreamSocket\.setTimeout\(0\)/u);
  assert.match(frontendServer, /browserSocket\.setTimeout\(0\)/u);
  assert.doesNotMatch(frontendServer, /http-proxy/u);
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

test("public frontend URLs come only from the canonical runtime origin", async () => {
  const sources = await Promise.all([
    workspaceFile("frontend/app/layout.tsx"),
    workspaceFile("frontend/app/robots.ts"),
    workspaceFile("frontend/app/sitemap.ts"),
    workspaceFile("frontend/app/app/auth/refresh/route.ts"),
    workspaceFile("frontend/lib/platform-api-proxy.ts"),
    workspaceFile("frontend/lib/admin-api-proxy.ts"),
    workspaceFile("frontend/lib/storage-upload-relay.ts")
  ]);
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /NEXT_PUBLIC_SITE_URL/u);
  assert.doesNotMatch(combined, /http:\/\/localhost(?::\d+)?/u);
  assert.match(combined, /webPublicOrigin\(\)/u);
  assert.match(
    sources[3],
    /new URL\(returnTo, webPublicOrigin\(\)\)/u
  );
});

test("the configured www host redirects to the canonical origin", async () => {
  const [proxy, redirect] = await Promise.all([
    workspaceFile("frontend/proxy.ts"),
    workspaceFile("frontend/lib/canonical-host-redirect.ts")
  ]);

  assert.match(proxy, /canonicalHostRedirectUrl/u);
  assert.match(proxy, /NextResponse\.redirect\(canonicalRedirect, 308\)/u);
  assert.match(redirect, /WEB_WWW_REDIRECT_HOST/u);
  assert.match(redirect, /webPublicOrigin\(env\)/u);
  assert.doesNotMatch(redirect, /requestUrl\.origin/u);
});

test("production admin bootstrap is self-contained and terminal-safe", async () => {
  const [source, runtimeEntrypoint, apiPackage, documentation] =
    await Promise.all([
      workspaceFile(
        "backend-core/modules/api/src/admin/platform-admin-bootstrap.ts"
      ),
      workspaceFile("backend-core/src/platform-admin-bootstrap.ts"),
      workspaceFile("backend-core/modules/api/package.json"),
      infrastructureFile("DOKPLOY.md")
    ]);
  assert.doesNotMatch(source, /dotenv/u);
  assert.match(source, /PLATFORM_DATABASE_URL/u);
  assert.match(
    runtimeEntrypoint,
    /@seo-platform\/backend-core-api\/platform-admin-bootstrap/u
  );
  assert.match(
    runtimeEntrypoint,
    /bootstrapModule\.runPlatformAdminBootstrap\(\)/u
  );
  assert.deepEqual(
    JSON.parse(apiPackage).exports["./platform-admin-bootstrap"],
    {
      types: "./dist/admin/platform-admin-bootstrap.d.ts",
      import: "./dist/admin/platform-admin-bootstrap.js"
    }
  );
  assert.match(
    documentation,
    /node \/app\/dist\/platform-admin-bootstrap\.js/u
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
