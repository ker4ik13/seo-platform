import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const infrastructureDirectory = path.resolve(testDirectory, "..");
const vpsDirectory = path.join(infrastructureDirectory, "vps");

const shellScripts = [
  "bootstrap-runtime.sh",
  "migrate-runtime.sh",
  "prepare-clamav.sh",
  "provision-object-storage.sh",
  "rotate-nats-credentials.sh",
  "rotate-object-storage-root.sh",
  "run-component.sh",
  "runtime-lib.sh",
  "smoke-runtime.sh",
  "start-runtime.sh",
  "status-runtime.sh",
  "stop-runtime.sh",
  "storage-proxy.sh",
  "supervise-component.sh",
];

async function readVpsFile(name) {
  return readFile(path.join(vpsDirectory, name), "utf8");
}

test("VPS runtime entrypoints are executable and syntactically valid Bash", async () => {
  for (const name of shellScripts) {
    const absolutePath = path.join(vpsDirectory, name);
    await access(absolutePath, constants.X_OK);
    const fileStat = await stat(absolutePath);
    assert.equal(
      fileStat.mode & 0o077,
      0,
      `${name} must not be readable or executable by other OS users`,
    );

    const result = spawnSync("/bin/bash", ["-n", absolutePath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("VPS runtime keeps every data service and application on loopback", async () => {
  const source = await readVpsFile("run-component.sh");

  assert.match(source, /postgres[\s\S]*-h 127\.0\.0\.1/);
  assert.match(source, /redis-jobs[\s\S]*bind 127\.0\.0\.1/);
  assert.match(source, /redis-realtime[\s\S]*bind 127\.0\.0\.1/);
  assert.match(source, /nats[\s\S]*host: "127\.0\.0\.1"/);
  assert.match(source, /--address 127\.0\.0\.1:9000/);
  assert.match(source, /--console-address 127\.0\.0\.1:9001/);
  assert.match(source, /BIND_ADDRESS=127\.0\.0\.1/g);
  assert.doesNotMatch(source, /--address 0\.0\.0\.0/);
  assert.doesNotMatch(source, /BIND_ADDRESS=0\.0\.0\.0/);
});

test("public object-storage proxy is exact, TLS-enabled and never receives credentials", async () => {
  const source = await readVpsFile("storage-proxy.sh");
  const componentSource = await readVpsFile("run-component.sh");

  assert.match(source, /http:\/\/127\.0\.0\.1:2019/);
  assert.match(source, /storage_listen=\$public_host:9443/);
  assert.match(source, /upstreams: \[\{dial: "127\.0\.0\.1:9000"\}\]/);
  assert.match(source, /tls_connection_policies: \[\{\}\]/);
  assert.match(componentSource, /storage-proxy[\s\S]*SEO_PLATFORM_PUBLIC_URL/);
  assert.doesNotMatch(
    componentSource.match(/storage-proxy\)[\s\S]*?;;/)?.[0] ?? "",
    /MINIO_ROOT_|S3_ACCESS_KEY|S3_SECRET/,
  );
});

test("runtime starts storage inspection before uploads and executes a real semantic smoke", async () => {
  const startSource = await readVpsFile("start-runtime.sh");
  const smokeSource = await readVpsFile("smoke-runtime.sh");

  assert.ok(
    startSource.indexOf("provision-object-storage.sh") <
      startSource.indexOf("for worker in"),
  );
  assert.ok(
    startSource.indexOf("wait_for_clamd") < startSource.indexOf("for worker in"),
  );
  assert.match(smokeSource, /part_url/);
  assert.match(smokeSource, /object-storage CORS/);
  assert.match(smokeSource, /suggestedTarget/);
  assert.match(smokeSource, /validation/);
  assert.match(smokeSource, /publish/);
  assert.match(smokeSource, /продвижение сайта/);
});

test("status includes external storage TLS and ClamAV readiness", async () => {
  const source = await readVpsFile("status-runtime.sh");

  assert.match(source, /public_storage_endpoint/);
  assert.match(source, /minio\/health\/ready/);
  assert.match(source, /zPING\\0/);
  assert.match(source, /9443/);
  assert.match(source, /3310/);
});
