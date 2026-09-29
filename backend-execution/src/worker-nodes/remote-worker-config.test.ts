import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRemoteWorkerConfig } from "./remote-worker-config.js";

const id = "01900000-0000-7000-8000-000000000001";

test("remote worker requires a private token file and verified HTTPS origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-config-"));
  const tokenFile = join(directory, "token");
  const token = `wn_${"a".repeat(43)}`;
  try {
    await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
    const env = {
      WORKER_CONTROL_URL: "https://144.31.221.28:4000",
      WORKER_NODE_ID: id,
      WORKER_NODE_TOKEN_FILE: tokenFile,
      WORKER_HTTP_SLOTS: "32",
      WORKER_RANK_SLOTS: "8",
      WORKER_CPU_SLOTS: "4"
    };
    const config = await loadRemoteWorkerConfig(env);
    assert.equal(config.controlUrl.origin, "https://144.31.221.28:4000");
    assert.equal(config.token, token);
    assert.equal(config.httpSlots, 32);
    assert.equal(config.rankSlots, 8);
    await assert.rejects(() => loadRemoteWorkerConfig({
      ...env, WORKER_CONTROL_URL: "http://144.31.221.28:4000"
    }));
    await assert.rejects(() => loadRemoteWorkerConfig({
      ...env, WORKER_CONTROL_URL: "https://user:pass@144.31.221.28:4000"
    }));
    await chmod(tokenFile, 0o644);
    await assert.rejects(() => loadRemoteWorkerConfig(env));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
