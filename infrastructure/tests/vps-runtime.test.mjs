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
  "configure-auth-email.sh",
  "configure-telegram-alerts.sh",
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

  assert.equal(nodeRuntimeCount, 13);
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

test("VPS platform rank credentials preserve price and secret boundaries", async () => {
  const source = await readVpsFile("run-component.sh");
  const bootstrapSource = await readVpsFile("bootstrap-runtime.sh");
  const coreBlock = source.match(/  backend-core\)[\s\S]*?    ;;/u)?.[0] ?? "";
  const executionBlock = source.match(/  backend-execution\)[\s\S]*?    ;;/u)?.[0] ?? "";
  const connectorBlock = source.match(/  connector-worker\|connector-worker-2\|connector-worker-3\)[\s\S]*?    ;;/u)?.[0] ?? "";

  assert.match(coreBlock, /PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR/u);
  assert.match(coreBlock, /PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR/u);
  assert.match(coreBlock, /PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR/u);
  assert.match(coreBlock, /PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR/u);
  assert.match(coreBlock, /PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR/u);
  assert.match(coreBlock, /PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR/u);
  assert.doesNotMatch(coreBlock, /PLATFORM_(?:XMLSTOCK|ARSENKIN)_API_KEY/u);
  assert.match(executionBlock, /PLATFORM_XMLSTOCK_API_KEY/u);
  assert.match(executionBlock, /PLATFORM_ARSENKIN_API_KEY/u);
  assert.doesNotMatch(executionBlock, /RANK_KEYWORD_PRICE_MINOR/u);
  assert.doesNotMatch(connectorBlock, /PLATFORM_(?:XMLSTOCK|ARSENKIN)_API_KEY/u);
  assert.match(
    coreBlock,
    /JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN/u
  );
  assert.match(
    connectorBlock,
    /JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN/u
  );
  assert.match(
    bootstrapSource,
    /if ! grep -q '\^JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN=' "\$runtime_env_file"/u
  );
});

test("VPS operational alerts isolate Telegram secret and hash error details", async () => {
  const componentSource = await readVpsFile("run-component.sh");
  const startSource = await readVpsFile("start-runtime.sh");
  const statusSource = await readVpsFile("status-runtime.sh");
  const supervisorSource = await readVpsFile("supervise-component.sh");
  const configureSource = await readVpsFile("configure-telegram-alerts.sh");
  const alertBlock = componentSource.match(/  operational-alerts\)[\s\S]*?    ;;/u)?.[0] ?? "";
  const coreBlock = componentSource.match(/  backend-core\)[\s\S]*?    ;;/u)?.[0] ?? "";

  assert.match(alertBlock, /BIND_ADDRESS=127\.0\.0\.1/u);
  assert.match(alertBlock, /OPERATIONAL_ALERTS_PORT=4004/u);
  assert.match(alertBlock, /TELEGRAM_ALERT_BOT_TOKEN/u);
  assert.doesNotMatch(coreBlock, /TELEGRAM_ALERT_BOT_TOKEN/u);
  assert.ok(
    startSource.indexOf("start_window operational-alerts") <
      startSource.indexOf("start_window backend-core")
  );
  assert.match(statusSource, /4004\/health\/ready/u);
  assert.match(supervisorSource, /sha256sum \| cut -c1-16/u);
  assert.match(supervisorSource, /CHILD_ERROR_LOG ERROR/u);
  assert.match(supervisorSource, /UNEXPECTED_PROCESS_EXIT/u);
  assert.doesNotMatch(supervisorSource, /body: JSON\.stringify\([^)]*line/u);
  assert.match(configureSource, /read -r -s entered_token/u);
  assert.match(configureSource, /Telegram canary failed/u);
  assert.doesNotMatch(configureSource, /printf[^\n]*bot_token/u);
});

test("VPS auth-email keeps SMTP in one optional isolated worker", async () => {
  const componentSource = await readVpsFile("run-component.sh");
  const startSource = await readVpsFile("start-runtime.sh");
  const statusSource = await readVpsFile("status-runtime.sh");
  const configureSource = await readVpsFile("configure-auth-email.sh");
  const supervisorSource = await readVpsFile("supervise-component.sh");
  const stopSource = await readVpsFile("stop-runtime.sh");
  const workerBlock = componentSource.match(/  auth-email-worker\)[\s\S]*?    ;;/u)?.[0] ?? "";

  assert.match(workerBlock, /jobs_auth_email_runtime/u);
  assert.match(workerBlock, /NATS_AUTH_EMAIL_CONSUMER_USER/u);
  assert.match(workerBlock, /JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN/u);
  assert.match(workerBlock, /AUTH_EMAIL_SMTP_PASSWORD/u);
  assert.doesNotMatch(workerBlock, /REDIS_URL|S3_|INTEGRATION_CREDENTIAL/u);
  assert.match(componentSource, /AUTH_EMAIL_VERIFICATION_REQUIRED="\$\{AUTH_EMAIL_ENABLED:-false\}"/u);
  assert.match(startSource, /AUTH_EMAIL_ENABLED:-false/u);
  assert.match(startSource, /start_window auth-email-worker/u);
  assert.match(startSource, /seo-platform-auth-email-worker\.ready/u);
  assert.match(statusSource, /service=auth-email-worker status=ready/u);
  assert.match(configureSource, /runtime\.env\.tmp\.\$\$/u);
  assert.match(configureSource, /read -r -s entered_password/u);
  assert.match(configureSource, /await transport\.verify\(\)/u);
  assert.doesNotMatch(configureSource, /printf[^\n]*smtp_password/u);
  assert.match(supervisorSource, /component" = auth-email-worker/u);
  assert.match(supervisorSource, /shutdown_attempts=20/u);
  assert.match(stopSource, /attempt <= 20/u);
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
  assert.match(connectorBlock, /DATABASE_POOL_MAX=12/u);
  assert.match(connectorBlock, /INTEGRATION_VALIDATION_CONCURRENCY=1/u);
  assert.match(connectorBlock, /CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS=1000/u);
  assert.match(connectorBlock, /RANK_CONNECTOR_CONCURRENCY=4/u);
  assert.match(connectorBlock, /FREQUENCY_COLLECTION_CONCURRENCY=1/u);
  assert.match(connectorBlock, /KEYWORD_RESEARCH_CONCURRENCY=1/u);
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
