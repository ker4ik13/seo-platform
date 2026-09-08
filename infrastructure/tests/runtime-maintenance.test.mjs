import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { maintainRuntime } from "../vps/maintain-runtime.mjs";

test("daily cleanup removes only expired archives and owned temporary runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "seo-maintenance-test-"));
  const old = new Date(Date.now() - 30 * 86_400_000);
  try {
    for (const path of ["logs", "tmp", "postgres/data", "object-storage", "tmp/smoke-runtime.expired", "tmp/e2e.active", "tmp/user-import"]) {
      await mkdir(join(root, path), { recursive: true });
    }
    for (const path of ["logs/web.log", "logs/web.log.1", "logs/jobs-api.acl-failure-20260731.log", "postgres/data/important", "object-storage/important", "tmp/user-import/important"]) {
      await writeFile(join(root, path), "keep");
      await utimes(join(root, path), old, old);
    }
    await writeFile(join(root, "tmp/e2e.active/owner.pid"), String(process.pid));
    await symlink(join(root, "postgres"), join(root, "tmp/e2e.symlink"));
    for (const name of ["smoke-runtime.expired", "e2e.active", "user-import"]) {
      await utimes(join(root, "tmp", name), old, old);
    }
    const preview = await maintainRuntime(root, { dryRun: true });
    assert.equal(preview.removedArchives, 2);
    assert.equal(preview.removedTemporaryDirectories, 1);
    assert.equal(await readFile(join(root, "logs/web.log.1"), "utf8"), "keep");
    const result = await maintainRuntime(root);
    assert.equal(result.removedArchives, 2);
    assert.equal(result.removedTemporaryDirectories, 1);
    for (const path of ["logs/web.log", "postgres/data/important", "object-storage/important", "tmp/user-import/important"]) {
      assert.equal(await readFile(join(root, path), "utf8"), "keep");
    }
    assert.equal(await readFile(join(root, "tmp/e2e.active/owner.pid"), "utf8"), String(process.pid));
    assert.equal(await readFile(join(root, "tmp/e2e.symlink/data/important"), "utf8"), "keep");
    const again = await maintainRuntime(root);
    assert.equal(again.removedArchives, 0);
    assert.equal(again.removedTemporaryDirectories, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
