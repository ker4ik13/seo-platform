import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { writeBoundedLog } from "../vps/bounded-log.mjs";

test("bounds a flood of output and retains the newest two segments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-log-test-"));
  const path = join(directory, "service.log");
  try {
    await writeBoundedLog(Readable.from([Buffer.from("0123456789".repeat(20)), "latest"]), path, 32);
    assert.ok((await stat(path)).size <= 32);
    assert.ok((await stat(`${path}.1`)).size <= 32);
    assert.equal((await stat(path)).mode & 0o077, 0);
    assert.equal((await stat(`${path}.1`)).mode & 0o077, 0);
    const retained = (await readFile(`${path}.1`, "utf8")) + (await readFile(path, "utf8"));
    assert.ok(("0123456789".repeat(20) + "latest").endsWith(retained));
    assert.ok(retained.endsWith("latest"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compacts an oversized legacy log on startup without keeping a giant archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-log-test-"));
  const path = join(directory, "service.log");
  try {
    await writeFile(path, "old".repeat(100) + "keep-this-tail");
    await writeFile(`${path}.1`, "obsolete".repeat(100));
    await writeBoundedLog(Readable.from(["fresh"]), path, 32);
    assert.equal(await readFile(path, "utf8"), "fresh");
    assert.equal((await stat(`${path}.1`)).size, 32);
    assert.ok((await readFile(`${path}.1`, "utf8")).endsWith("keep-this-tail"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
