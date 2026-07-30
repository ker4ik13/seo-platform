import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root exposes conventional Dokploy build and start scripts", async () => {
  const rootPackage = await packageManifest("../../package.json");
  const webPackage = await packageManifest("../../platform-web/package.json");

  assert.equal(
    rootPackage.scripts["build:landing"],
    "pnpm --filter @seo-platform/contracts build && pnpm --filter @seo-platform/web build"
  );
  assert.equal(rootPackage.scripts.build, "pnpm run build:landing");
  assert.equal(rootPackage.scripts.dev, "pnpm run dev:landing");
  assert.match(rootPackage.scripts["build:all"], /--recursive/u);
  assert.equal(rootPackage.scripts.start, "pnpm --filter @seo-platform/web start");
  assert.equal(
    rootPackage.scripts["start:landing"],
    rootPackage.scripts.start
  );
  assert.equal(webPackage.scripts.build, "next build");
  assert.equal(webPackage.scripts.start, "next start");
  assert.equal(webPackage.scripts.dev, "next dev");
  assert.doesNotMatch(
    webPackage.scripts.start,
    /(?:^|\s)(?:--port|-p)(?:\s|$)/u,
    "Next.js must receive PORT from Dokploy instead of a hard-coded script flag"
  );
});

async function packageManifest(relativePath) {
  return JSON.parse(
    await readFile(new URL(relativePath, import.meta.url), "utf8")
  );
}
