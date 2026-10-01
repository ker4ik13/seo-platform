import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerBuildHash } from "./worker-build-version.js";

test("worker build version changes with executable code, not file discovery order", async () => {
  const root = await mkdtemp(join(tmpdir(), "seo-worker-build-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "b.js"), "export const value = `SELECT\n2`;\n");
    await writeFile(join(root, "a.js"), "export const value = 1;\n");
    const first = await workerBuildHash(root);
    assert.match(first, /^[a-f0-9]{64}$/u);
    assert.equal(await workerBuildHash(root), first);
    await writeFile(join(root, "a.js"), "export const value = 1;\r\n");
    await writeFile(join(root, "nested", "b.js"), "export const value = `SELECT\r\n2`;\r\n");
    assert.equal(await workerBuildHash(root), first, "Windows and Linux line endings identify the same build");
    await writeFile(join(root, "nested", "b.js"), "export const value = `SELECT\r\n3`;\r\n");
    assert.notEqual(await workerBuildHash(root), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
