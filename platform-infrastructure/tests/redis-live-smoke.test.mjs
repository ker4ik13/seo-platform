import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const redisServerPath = process.env.PLATFORM_INFRA_REDIS_SERVER_BIN;
const liveTestOptions = {
  skip: redisServerPath
    ? false
    : "PLATFORM_INFRA_REDIS_SERVER_BIN is not configured",
  timeout: 60_000
};
const rendererPath = fileURLToPath(
  new URL("../redis/render-acl.sh", import.meta.url)
);
const jobsConfigPath = fileURLToPath(
  new URL("../redis/jobs.conf", import.meta.url)
);
const realtimeConfigPath = fileURLToPath(
  new URL("../redis/realtime.conf", import.meta.url)
);
const directusConfigPath = fileURLToPath(
  new URL("../redis/directus.conf", import.meta.url)
);
const jobsRequire = createRequire(
  new URL("../../platform-jobs-integrations/package.json", import.meta.url)
);
const realtimeRequire = createRequire(
  new URL("../../platform-realtime/package.json", import.meta.url)
);
const { Queue, Worker } = jobsRequire("bullmq");
const ioRedisModule = jobsRequire("ioredis");
const IoRedis = ioRedisModule.default ?? ioRedisModule;
const { createClient } = realtimeRequire("redis");

const jobsUsers = [
  ["seo_jobs_api", "REDIS_JOBS_API_PASSWORD", "system"],
  ["seo_jobs_system", "REDIS_JOBS_SYSTEM_PASSWORD", "system"],
  [
    "seo_jobs_inspection",
    "REDIS_JOBS_INSPECTION_PASSWORD",
    "upload-inspection"
  ],
  ["seo_jobs_import", "REDIS_JOBS_IMPORT_PASSWORD", "semantic-import"],
  ["seo_jobs_rank", "REDIS_JOBS_RANK_PASSWORD", "rank-preparation"],
  [
    "seo_jobs_connector",
    "REDIS_JOBS_CONNECTOR_PASSWORD",
    "integration-credential-validation"
  ]
];

test("Redis 8 Jobs ACL runs BullMQ and enforces queue keyspaces", liveTestOptions, async () => {
  const secrets = redisSecrets();
  await withRedis("jobs", jobsConfigPath, secrets, async ({ port }) => {
    await assertHealthBoundary(port);

    for (const [username, secretName, queueName] of jobsUsers) {
      const client = jobsClient(port, username, secrets[secretName]);
      try {
        await client.connect();
        assert.equal(await client.ping(), "PONG");
        const allowedKey = `seo-platform:jobs:v1:${queueName}:live-${randomUUID()}`;
        await client.set(allowedKey, "allowed", "PX", 10_000);
        assert.equal(await client.get(allowedKey), "allowed");
        const forbiddenQueue =
          username === "seo_jobs_api"
            ? "unowned"
            : queueName === "system"
              ? "rank-preparation"
              : "system";
        await assert.rejects(
          client.set(
            `seo-platform:jobs:v1:${forbiddenQueue}:blocked-${randomUUID()}`,
            "blocked"
          ),
          /NOPERM/u
        );
      } finally {
        await closeIoRedis(client);
      }
    }

    const rankClient = jobsClient(
      port,
      "seo_jobs_rank",
      secrets.REDIS_JOBS_RANK_PASSWORD
    );
    try {
      await rankClient.connect();
      const info = await rankClient.info("server");
      assert.match(info, /redis_version:8\.8\.1\b/u);
      await assert.rejects(
        rankClient.eval(
          "return redis.call('SET', KEYS[1], 'blocked')",
          1,
          `seo-platform:jobs:v1:system:script-${randomUUID()}`
        ),
        /NOPERM/u
      );
      await assert.rejects(rankClient.call("CONFIG", "GET", "*"), /NOPERM/u);
      await assert.rejects(rankClient.call("SCAN", "0"), /NOPERM/u);
      await assert.rejects(rankClient.call("FLUSHALL"), /NOPERM/u);
    } finally {
      await closeIoRedis(rankClient);
    }

    await assertBullMqRoundTrip(port, secrets.REDIS_JOBS_RANK_PASSWORD);
  });
});

test("Redis 8 Realtime ACL permits only versioned adapter channels", liveTestOptions, async () => {
  const secrets = redisSecrets();
  await withRedis("realtime", realtimeConfigPath, secrets, async ({ port }) => {
    await assertHealthBoundary(port);
    const publisher = nodeRedisClient(
      port,
      "seo_realtime",
      secrets.REDIS_REALTIME_PASSWORD
    );
    const subscriber = publisher.duplicate();
    publisher.on("error", () => undefined);
    subscriber.on("error", () => undefined);
    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
      const channel = "seo-platform:realtime:v1#/collaboration#live-room";
      const messages = [];
      await subscriber.subscribe(channel, (payload) => messages.push(payload));
      assert.equal(await publisher.publish(channel, "live-payload"), 1);
      for (let attempt = 0; messages.length === 0 && attempt < 100; attempt += 1) {
        await delay(10);
      }
      assert.deepEqual(messages, ["live-payload"]);

      assert.equal(
        await publisher.publish(
          "seo-platform:realtime:v1-request#/collaboration#",
          "request"
        ),
        0
      );
      assert.equal(
        await publisher.publish(
          "seo-platform:realtime:v1-response#/collaboration#live-node",
          "response"
        ),
        0
      );
      await assert.rejects(
        publisher.set("seo-platform:realtime:v1:presence:blocked", "blocked"),
        /NOPERM/u
      );
      await assert.rejects(
        publisher.publish(
          "seo-platform:realtime:v1-presence#/collaboration#blocked",
          "blocked"
        ),
        /NOPERM/u
      );
    } finally {
      await Promise.all([closeNodeRedis(publisher), closeNodeRedis(subscriber)]);
    }
  });
});

test("Redis 8 Directus ACL supports cache operations but denies administration", liveTestOptions, async () => {
  const secrets = redisSecrets();
  await withRedis("directus", directusConfigPath, secrets, async ({ port }) => {
    await assertHealthBoundary(port);
    const client = nodeRedisClient(
      port,
      "seo_directus",
      secrets.REDIS_DIRECTUS_PASSWORD
    );
    client.on("error", () => undefined);
    try {
      await client.connect();
      const key = `seo-platform:directus:v1:live-${randomUUID()}`;
      assert.equal(await client.set(key, "cached", { PX: 10_000 }), "OK");
      assert.equal(await client.get(key), "cached");
      assert.ok((await client.pTTL(key)) > 0);
      assert.equal(await client.del(key), 1);
      await assert.rejects(client.configGet("*"), /NOPERM/u);
      await assert.rejects(client.flushAll(), /NOPERM/u);
      await assert.rejects(client.aclList(), /NOPERM/u);
    } finally {
      await closeNodeRedis(client);
    }
  });
});

async function assertBullMqRoundTrip(port, password) {
  const connection = {
    host: "127.0.0.1",
    port,
    username: "seo_jobs_rank",
    password,
    maxRetriesPerRequest: null,
    retryStrategy: () => null
  };
  const options = {
    connection,
    prefix: "seo-platform:jobs:v1"
  };
  const queue = new Queue("rank-preparation", options);
  const worker = new Worker(
    "rank-preparation",
    async (job) => ({ accepted: job.data.marker }),
    options
  );
  worker.on("error", () => undefined);
  try {
    await withDeadline(
      Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]),
      5_000,
      "BullMQ clients did not become ready"
    );
    const marker = randomUUID();
    const completion = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("BullMQ live job did not complete")),
        10_000
      );
      worker.once("completed", (job, result) => {
        clearTimeout(timer);
        resolve({ id: job.id, result });
      });
      worker.once("failed", (job, error) => {
        clearTimeout(timer);
        reject(
          new Error(`BullMQ live job ${job?.id ?? "unknown"} failed`, {
            cause: error
          })
        );
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error("BullMQ worker Redis command failed", { cause: error }));
      });
    });
    const job = await queue.add(
      "live-smoke",
      { marker },
      { removeOnComplete: true, removeOnFail: true }
    );
    assert.deepEqual(await completion, {
      id: job.id,
      result: { accepted: marker }
    });
  } finally {
    await Promise.allSettled([worker.close(true), queue.close()]);
  }
}

async function assertHealthBoundary(port) {
  const health = nodeRedisClient(port, "seo_health", "health");
  health.on("error", () => undefined);
  try {
    await health.connect();
    assert.equal(await health.ping(), "PONG");
    await assert.rejects(health.get("blocked"), /NOPERM/u);
  } finally {
    await closeNodeRedis(health);
  }

  const defaultUser = createClient({
    socket: { host: "127.0.0.1", port, reconnectStrategy: false }
  });
  defaultUser.on("error", () => undefined);
  try {
    try {
      await defaultUser.connect();
      await assert.rejects(defaultUser.ping(), /NOAUTH/u);
    } catch (error) {
      assert.match(String(error), /NOAUTH/u);
    }
  } finally {
    await closeNodeRedis(defaultUser);
  }
}

async function withRedis(instance, configPath, secrets, assertion) {
  assert.ok(redisServerPath);
  await access(redisServerPath, constants.X_OK);
  const directory = await mkdtemp(join(tmpdir(), `seo-platform-redis-${instance}-`));
  const aclPath = join(directory, "users.acl");
  const dataPath = join(directory, "data");
  const runtimeConfigPath = join(directory, "redis.conf");
  await mkdir(dataPath, { mode: 0o700 });
  await execute("/bin/sh", [rendererPath, instance, aclPath], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      ...secrets
    }
  });
  const port = await availablePort();
  await writeRuntimeConfig(
    configPath,
    runtimeConfigPath,
    aclPath,
    dataPath,
    port
  );
  const server = startRedis(runtimeConfigPath, dataPath);
  try {
    await waitForRedis(server, port);
    await assertion({ port });
  } finally {
    await stopRedis(server);
    await rm(directory, { force: true, recursive: true });
  }
}

async function writeRuntimeConfig(
  sourcePath,
  destinationPath,
  aclPath,
  dataPath,
  port
) {
  const source = await readFile(sourcePath, "utf8");
  const replacements = [
    [/^bind .*$/mu, "bind 127.0.0.1"],
    [/^port .*$/mu, `port ${port}`],
    [/^aclfile .*$/mu, `aclfile ${aclPath}`],
    [/^dir .*$/mu, `dir ${dataPath}`]
  ];
  let rendered = source;
  for (const [pattern, replacement] of replacements) {
    assert.match(rendered, pattern);
    rendered = rendered.replace(pattern, replacement);
  }
  await writeFile(destinationPath, rendered, { encoding: "utf8", mode: 0o600 });
}

function startRedis(configPath, dataPath) {
  const child = spawn(
    redisServerPath,
    [
      configPath,
      "--pidfile",
      join(dataPath, "redis.pid"),
      "--logfile",
      ""
    ],
    {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.liveOutput = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      child.liveOutput = `${child.liveOutput}${chunk}`.slice(-16_000);
    });
  }
  return child;
}

async function waitForRedis(child, port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Redis exited before readiness\n${child.liveOutput}`);
    }
    if (await canConnect(port)) return;
    await delay(50);
  }
  throw new Error(`Redis readiness timed out\n${child.liveOutput}`);
}

async function stopRedis(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  let timeout;
  const forced = new Promise((resolve) => {
    timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5_000);
  });
  await Promise.race([exited, forced]);
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) await exited;
}

async function withDeadline(promise, milliseconds, message) {
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timeout);
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (connected) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(100);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function jobsClient(port, username, password) {
  const client = new IoRedis({
    host: "127.0.0.1",
    port,
    username,
    password,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1
  });
  client.on("error", () => undefined);
  return client;
}

function nodeRedisClient(port, username, password) {
  return createClient({
    username,
    password,
    socket: { host: "127.0.0.1", port, reconnectStrategy: false }
  });
}

async function closeIoRedis(client) {
  if (client.status === "end") return;
  if (client.status === "wait") {
    client.disconnect(false);
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect(false);
  }
}

async function closeNodeRedis(client) {
  if (client.isOpen) client.close();
}

function redisSecrets() {
  return {
    REDIS_JOBS_API_PASSWORD: randomSecret(),
    REDIS_JOBS_SYSTEM_PASSWORD: randomSecret(),
    REDIS_JOBS_INSPECTION_PASSWORD: randomSecret(),
    REDIS_JOBS_IMPORT_PASSWORD: randomSecret(),
    REDIS_JOBS_RANK_PASSWORD: randomSecret(),
    REDIS_JOBS_CONNECTOR_PASSWORD: randomSecret(),
    REDIS_REALTIME_PASSWORD: randomSecret(),
    REDIS_DIRECTUS_PASSWORD: randomSecret()
  };
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}
