import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("landing Compose is autonomous and publishes only to loopback by default", async () => {
  const compose = await infrastructureFile("compose.landing.yml");
  const serviceNames = [...compose.matchAll(/^  ([a-z0-9][a-z0-9-]*):$/gmu)]
    .map((match) => match[1]);

  assert.deepEqual(serviceNames, ["landing"]);
  assert.match(
    compose,
    /"\$\{LANDING_BIND_ADDRESS:-127\.0\.0\.1\}:\$\{LANDING_PORT:-3000\}:3000"/u
  );
  assert.match(compose, /LANDING_PUBLIC_URL:\?LANDING_PUBLIC_URL is required/u);
  assert.match(compose, /NEXT_PUBLIC_TELEGRAM_CHANNEL_URL/u);
  assert.match(compose, /no-new-privileges:true/u);
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:3000\/ru'\)/u);
  assert.doesNotMatch(
    compose,
    /depends_on:|DATABASE_URL|REDIS_|_TOKEN|_PASSWORD/u,
    "public landing must not depend on backend services or receive credentials"
  );
});

test("Telegram channel URL is embedded before the Web production build", async () => {
  const dockerfile = await infrastructureFile("docker/web.Dockerfile");
  const lines = dockerfile.split(/\r?\n/u);
  const argIndex = lines.indexOf(
    "ARG NEXT_PUBLIC_TELEGRAM_CHANNEL_URL=https://t.me/seonorita_app"
  );
  const envIndex = lines.indexOf(
    "ENV NEXT_PUBLIC_TELEGRAM_CHANNEL_URL=$NEXT_PUBLIC_TELEGRAM_CHANNEL_URL"
  );
  const buildIndex = lines.findIndex((line) =>
    line.startsWith('RUN pnpm --filter "$TARGET_PACKAGE" build')
  );

  assert.notEqual(argIndex, -1);
  assert.notEqual(envIndex, -1);
  assert.notEqual(buildIndex, -1);
  assert.ok(argIndex < envIndex && envIndex < buildIndex);
});

async function infrastructureFile(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
