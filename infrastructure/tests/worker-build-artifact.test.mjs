import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("backend-execution cleans stale emitted JavaScript before each build", async () => {
  const packagePath = fileURLToPath(new URL("../../backend-execution/package.json", import.meta.url));
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  assert.match(packageJson.scripts.build, /node scripts\/clean-dist\.mjs && tsc -p tsconfig\.build\.json/u);
});
