import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerEntrypoints = [
  "connector-worker.main.ts",
  "crawl-worker.main.ts",
  "import-worker.main.ts",
  "inspection-worker.main.ts",
  "rank-worker.main.ts"
];

test("Jobs workers exit after a fatal bootstrap failure", async () => {
  for (const entrypoint of workerEntrypoints) {
    const source = await readFile(
      new URL(
        `../../platform-jobs-integrations/src/${entrypoint}`,
        import.meta.url
      ),
      "utf8"
    );
    const fatalHandler = /void bootstrap\(\)\.catch\(\(\) => \{([\s\S]*?)\n\}\);/u.exec(
      source
    )?.[1];

    assert.ok(fatalHandler, `${entrypoint} must handle bootstrap rejection`);
    assert.match(fatalHandler, /logger\.error\(/u);
    assert.match(fatalHandler, /process\.exit\(1\);/u);
    assert.doesNotMatch(fatalHandler, /process\.exitCode/u);
  }
});
