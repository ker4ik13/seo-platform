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
  "billing-webhook-proxy.sh",
  "configure-yookassa.sh",
  "configure-web-push.sh",
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
  const supervisor = await readVpsFile("supervise-component.sh");
  assert.match(supervisor, /kill -TERM "\$child_pid"/u);
  assert.match(supervisor, /kill -KILL "\$child_pid"/u);
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

test("VPS runtime uses UTC for PostgreSQL and every Node process", async () => {
  const source = await readVpsFile("run-component.sh");
  const nodeRuntimeCount = [...source.matchAll(/NODE_ENV=production \\/gu)].length;
  const utcRuntimeCount = [...source.matchAll(/TZ=UTC \\/gu)].length;

  assert.equal(nodeRuntimeCount, 11);
  assert.equal(utcRuntimeCount, nodeRuntimeCount);
  assert.match(source, /postgres[\s\S]*-c timezone=UTC/);
});

test("VPS Web Push keeps sender secrets in the isolated worker", async () => {
  const componentSource = await readVpsFile("run-component.sh");
  const startSource = await readVpsFile("start-runtime.sh");
  const configureSource = await readVpsFile("configure-web-push.sh");
  const realtimeBlock = componentSource.match(/  realtime\)[\s\S]*?    ;;/u)?.[0] ?? "";
  const workerBlock = componentSource.match(/  web-push-worker\)[\s\S]*?    ;;/u)?.[0] ?? "";

  assert.match(realtimeBlock, /WEB_PUSH_REGISTRATION_ENABLED/u);
  assert.match(realtimeBlock, /WEB_PUSH_VAPID_PUBLIC_KEY/u);
  assert.doesNotMatch(realtimeBlock, /WEB_PUSH_VAPID_PRIVATE_KEY/u);
  assert.match(workerBlock, /SERVICE_ROLE=WEB_PUSH_WORKER/u);
  assert.match(workerBlock, /WEB_PUSH_VAPID_PRIVATE_KEY/u);
  assert.doesNotMatch(workerBlock, /PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN/u);
  assert.match(startSource, /start_window web-push-worker/u);
  assert.match(configureSource, /runtime\.env\.tmp\.\$\$/u);
  assert.doesNotMatch(configureSource, /printf[^\n]*vapid_(?:public|private)_key/u);
});

test("VPS YooKassa adapter is operator-configurable and disabled by default", async () => {
  const source = await readVpsFile("run-component.sh");
  const startSource = await readVpsFile("start-runtime.sh");
  const configureSource = await readVpsFile("configure-yookassa.sh");
  const webhookSource = await readVpsFile("billing-webhook-proxy.sh");
  const platformBlock = source.match(/  backend-core\)[\s\S]*?    ;;/u)?.[0] ?? "";

  assert.match(platformBlock, /YOOKASSA_ENABLED="\$\{YOOKASSA_ENABLED:-false\}"/u);
  assert.match(platformBlock, /YOOKASSA_SHOP_ID/u);
  assert.match(platformBlock, /YOOKASSA_SECRET_KEY/u);
  assert.match(platformBlock, /BILLING_RECONCILIATION_ENABLED/u);
  assert.match(platformBlock, /BILLING_RECONCILIATION_INTERVAL_MS/u);
  assert.match(platformBlock, /BILLING_RECONCILIATION_BATCH_SIZE/u);
  assert.match(startSource, /start_window billing-webhook-proxy/u);
  assert.match(configureSource, /runtime\.env\.tmp\.\$\$/u);
  assert.match(configureSource, /read -r -s entered_secret/u);
  assert.doesNotMatch(configureSource, /printf[^\n]*secret_key/u);
  assert.match(webhookSource, /\/api\/v1\/billing\/providers\/yookassa\/webhook/u);
  assert.match(webhookSource, /127\.0\.0\.1:4000/u);
  assert.match(webhookSource, /webhook_listen=\$public_host:443/u);
});

test("VPS rank and connector runtimes run multiple bounded processes", async () => {
  const [source, startSource] = await Promise.all([
    readVpsFile("run-component.sh"),
    readVpsFile("start-runtime.sh")
  ]);
  const rankBlock = source.match(/  rank-worker\|rank-worker-2\)[\s\S]*?    ;;/u)?.[0] ?? "";
  const connectorBlock = source.match(/  connector-worker\|connector-worker-2\|connector-worker-3\)[\s\S]*?    ;;/u)?.[0] ?? "";

  assert.match(rankBlock, /RANK_PREPARATION_DISPATCH_SECONDS=5/u);
  assert.match(rankBlock, /RANK_PREPARATION_CONCURRENCY=5/u);
  assert.match(connectorBlock, /INTEGRATION_VALIDATION_DISPATCH_SECONDS=5/u);
  assert.match(connectorBlock, /INTEGRATION_VALIDATION_CONCURRENCY=8/u);
  assert.match(connectorBlock, /CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS=1000/u);
  assert.match(connectorBlock, /RANK_CONNECTOR_CONCURRENCY=16/u);
  assert.match(connectorBlock, /FREQUENCY_COLLECTION_CONCURRENCY=8/u);
  assert.match(startSource, /rank-worker-2/u);
  assert.match(startSource, /connector-worker-2/u);
  assert.match(startSource, /connector-worker-3/u);
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
  assert.match(smokeSource, /SEO_PLATFORM_SMOKE_STORAGE_RELAY/);
  assert.match(smokeSource, /app\/api\/storage-upload/);
  assert.match(smokeSource, /object-storage CORS/);
  assert.match(smokeSource, /suggestedTarget/);
  assert.match(smokeSource, /validation/);
  assert.match(smokeSource, /publish/);
  assert.match(smokeSource, /продвижение сайта/);
});

test("runtime smoke accepts the free-plan lifecycle and exact missing-connector conflict", async () => {
  const source = await readVpsFile("smoke-runtime.sh");

  assert.match(source, /TRIALING\|ACTIVE/u);
  assert.match(
    source,
    /expect_status 409 keyword-research-requires-connector/u
  );
  assert.match(source, /\.error\.code == "RESOURCE_STATE_CONFLICT"/u);
});

test("status includes external storage TLS and ClamAV readiness", async () => {
  const source = await readVpsFile("status-runtime.sh");

  assert.match(source, /public_storage_endpoint/);
  assert.match(source, /minio\/health\/ready/);
  assert.match(source, /zPING\\0/);
  assert.match(source, /9443/);
  assert.match(source, /3310/);
});
