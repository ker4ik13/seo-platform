import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const rendererUrl = new URL("../redis/render-acl.sh", import.meta.url);
const startUrl = new URL("../redis/start-redis.sh", import.meta.url);
const realtimeAdapterUrl = new URL(
  "../../platform-realtime/src/realtime/redis-io.adapter.ts",
  import.meta.url
);
const rendererPath = fileURLToPath(rendererUrl);
const startPath = fileURLToPath(startUrl);
const jobsPasswords = new Map([
  ["seo_jobs_api", "REDIS_JOBS_API_PASSWORD"],
  ["seo_jobs_system", "REDIS_JOBS_SYSTEM_PASSWORD"],
  ["seo_jobs_inspection", "REDIS_JOBS_INSPECTION_PASSWORD"],
  ["seo_jobs_import", "REDIS_JOBS_IMPORT_PASSWORD"],
  ["seo_jobs_rank", "REDIS_JOBS_RANK_PASSWORD"],
  ["seo_jobs_crawl", "REDIS_JOBS_CRAWL_PASSWORD"],
  ["seo_jobs_connector", "REDIS_JOBS_CONNECTOR_PASSWORD"]
]);

test("renderer is POSIX shell and writes hashed least-privilege Jobs ACLs", async () => {
  await Promise.all([
    execute("/bin/sh", ["-n", rendererPath]),
    execute("/bin/sh", ["-n", startPath])
  ]);
  const environment = validRedisEnvironment();
  await withRenderedAcl("jobs", environment, async ({ acl, mode, output }) => {
    assert.equal(output.stdout, "");
    assert.equal(output.stderr, "");
    assert.equal(mode, 0o600);
    assertSafeAclPreamble(acl);
    assertDoesNotExposeSecrets(acl, environment);

    const lines = acl.trimEnd().split("\n");
    assert.equal(lines.length, 9);
    for (const [username, secretName] of jobsPasswords) {
      const line = userLine(lines, username);
      assert.match(line, new RegExp(`#${sha256(environment[secretName])}\\b`, "u"));
      assert.match(line, /\s-@all\s/u);
      assert.match(line, /\sresetchannels(?:\s|$)/u);
      assert.doesNotMatch(line, /\s&\*/u);
      for (const forbidden of [
        "+@all",
        "+acl",
        "+config",
        "+flushall",
        "+flushdb",
        "+keys",
        "+scan",
        "+select",
        "+monitor",
        "+module",
        "+function"
      ]) {
        assert.equal(
          line.includes(forbidden),
          false,
          `${username} must not receive ${forbidden}`
        );
      }
    }

    assert.deepEqual(
      keyPatterns(userLine(lines, "seo_jobs_api")),
      [
        "~seo-platform:jobs:v1:crawl-automation:*",
        "~seo-platform:jobs:v1:crawls:*",
        "~seo-platform:jobs:v1:integration-credential-validation:*",
        "~seo-platform:jobs:v1:rank-automation:*",
        "~seo-platform:jobs:v1:rank-preparation:*",
        "~seo-platform:jobs:v1:semantic-import:*",
        "~seo-platform:jobs:v1:system:*",
        "~seo-platform:jobs:v1:upload-inspection:*"
      ]
    );
    assert.deepEqual(keyPatterns(userLine(lines, "seo_jobs_system")), [
      "~seo-platform:jobs:v1:system:*"
    ]);
    assert.deepEqual(keyPatterns(userLine(lines, "seo_jobs_inspection")), [
      "~seo-platform:jobs:v1:upload-inspection:*"
    ]);
    assert.deepEqual(keyPatterns(userLine(lines, "seo_jobs_import")), [
      "~seo-platform:jobs:v1:semantic-import:*"
    ]);
    assert.deepEqual(keyPatterns(userLine(lines, "seo_jobs_rank")), [
      "~seo-platform:jobs:v1:rank-preparation:*"
    ]);
    assert.deepEqual(keyPatterns(userLine(lines, "seo_jobs_crawl")), [
      "~seo-platform:jobs:v1:crawls:*"
    ]);
    assert.deepEqual(keyPatterns(userLine(lines, "seo_jobs_connector")), [
      "~seo-platform:jobs:v1:integration-credential-validation:*"
    ]);
  });
});

test("renderer isolates Realtime channels and the dedicated Directus cache", async () => {
  const environment = validRedisEnvironment();
  const realtimeAdapter = await readFile(realtimeAdapterUrl, "utf8");
  assert.match(
    realtimeAdapter,
    /REALTIME_REDIS_ADAPTER_KEY = "seo-platform:realtime:v1"/u
  );

  await withRenderedAcl("realtime", environment, async ({ acl }) => {
    assertSafeAclPreamble(acl);
    assertDoesNotExposeSecrets(acl, environment);
    const line = userLine(acl.trimEnd().split("\n"), "seo_realtime");
    assert.match(line, new RegExp(`#${sha256(environment.REDIS_REALTIME_PASSWORD)}\\b`, "u"));
    assert.deepEqual(channelPatterns(line), [
      "&seo-platform:realtime:v1#/collaboration#*",
      "&seo-platform:realtime:v1-request#/collaboration#",
      "&seo-platform:realtime:v1-response#/collaboration#*"
    ]);
    assert.deepEqual(keyPatterns(line), []);
    assert.match(line, /\s-@all\s/u);
    assert.match(line, /\s\+psubscribe(?:\s|$)/u);
    assert.match(line, /\s\+publish(?:\s|$)/u);
    assert.doesNotMatch(line, /\s\+@all(?:\s|$)/u);
  });

  await withRenderedAcl("directus", environment, async ({ acl }) => {
    assertSafeAclPreamble(acl);
    assertDoesNotExposeSecrets(acl, environment);
    const line = userLine(acl.trimEnd().split("\n"), "seo_directus");
    assert.match(line, new RegExp(`#${sha256(environment.REDIS_DIRECTUS_PASSWORD)}\\b`, "u"));
    assert.match(line, /\s~\*\s/u);
    assert.match(line, /\s&\*\s/u);
    assert.match(line, /\s\+@all\s/u);
    assert.match(line, /\s-@admin\s/u);
    assert.match(line, /\s-@dangerous(?:\s|$)/u);
  });
});

test("renderer fails closed without exposing invalid or reused secrets", async () => {
  const cases = [
    {
      instance: "jobs",
      mutate(environment) {
        delete environment.REDIS_JOBS_API_PASSWORD;
      },
      expected: /REDIS_JOBS_API_PASSWORD is required/u
    },
    {
      instance: "realtime",
      mutate(environment) {
        environment.REDIS_REALTIME_PASSWORD =
          "replace-me-production-realtime-password";
      },
      expected: /REDIS_REALTIME_PASSWORD must not use an example placeholder/u
    },
    {
      instance: "directus",
      mutate(environment) {
        environment.REDIS_DIRECTUS_PASSWORD = `${"x".repeat(40)}\n`;
      },
      expected: /REDIS_DIRECTUS_PASSWORD must be URL-safe/u
    },
    {
      instance: "jobs",
      mutate(environment) {
        environment.REDIS_JOBS_CONNECTOR_PASSWORD =
          environment.REDIS_JOBS_API_PASSWORD;
      },
      expected: /REDIS_JOBS_CONNECTOR_PASSWORD must be unique/u
    }
  ];

  for (const invalidCase of cases) {
    const environment = validRedisEnvironment();
    invalidCase.mutate(environment);
    const failure = await captureRenderFailure(
      invalidCase.instance,
      environment
    );
    assert.match(failure.stderr, invalidCase.expected);
    assertDoesNotExposeSecrets(
      `${failure.stdout}${failure.stderr}`,
      environment
    );
  }
});

async function withRenderedAcl(instance, environment, assertion) {
  const directory = await mkdtemp(join(tmpdir(), "seo-platform-redis-acl-"));
  const destination = join(directory, "users.acl");
  try {
    const output = await execute(
      "/bin/sh",
      [rendererPath, instance, destination],
      { encoding: "utf8", env: executionEnvironment(environment) }
    );
    const [acl, metadata] = await Promise.all([
      readFile(destination, "utf8"),
      stat(destination)
    ]);
    await assertion({ acl, mode: metadata.mode & 0o777, output });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function captureRenderFailure(instance, environment) {
  const directory = await mkdtemp(join(tmpdir(), "seo-platform-redis-acl-"));
  const destination = join(directory, "users.acl");
  try {
    await execute(
      "/bin/sh",
      [rendererPath, instance, destination],
      { encoding: "utf8", env: executionEnvironment(environment) }
    );
  } catch (error) {
    assert.equal(typeof error, "object");
    assert.notEqual(error, null);
    assert.notEqual(error.code, 0);
    return {
      stderr: String(error.stderr ?? ""),
      stdout: String(error.stdout ?? "")
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  assert.fail("Redis ACL renderer must fail closed");
}

function executionEnvironment(environment) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ...environment
  };
}

function validRedisEnvironment() {
  return {
    REDIS_JOBS_API_PASSWORD: `redis-jobs-api-${"a".repeat(40)}`,
    REDIS_JOBS_SYSTEM_PASSWORD: `redis-jobs-system-${"b".repeat(40)}`,
    REDIS_JOBS_INSPECTION_PASSWORD: `redis-jobs-inspection-${"c".repeat(40)}`,
    REDIS_JOBS_IMPORT_PASSWORD: `redis-jobs-import-${"d".repeat(40)}`,
    REDIS_JOBS_RANK_PASSWORD: `redis-jobs-rank-${"e".repeat(40)}`,
    REDIS_JOBS_CRAWL_PASSWORD: `redis-jobs-crawl-${"f".repeat(40)}`,
    REDIS_JOBS_CONNECTOR_PASSWORD: `redis-jobs-connector-${"g".repeat(40)}`,
    REDIS_REALTIME_PASSWORD: `redis-realtime-${"h".repeat(40)}`,
    REDIS_DIRECTUS_PASSWORD: `redis-directus-${"i".repeat(40)}`
  };
}

function assertSafeAclPreamble(acl) {
  const lines = acl.trimEnd().split("\n");
  assert.equal(
    lines[0],
    "user default reset off resetkeys resetchannels -@all"
  );
  assert.equal(
    lines[1],
    "user seo_health reset on nopass resetkeys resetchannels -@all +ping"
  );
}

function assertDoesNotExposeSecrets(output, environment) {
  for (const secret of Object.values(environment)) {
    assert.equal(
      output.includes(secret),
      false,
      "output must not expose Redis credential material"
    );
  }
}

function userLine(lines, username) {
  const line = lines.find((candidate) => candidate.startsWith(`user ${username} `));
  assert.equal(typeof line, "string", `${username} ACL must exist`);
  return line;
}

function keyPatterns(line) {
  return line.split(" ").filter((token) => token.startsWith("~")).sort();
}

function channelPatterns(line) {
  return line.split(" ").filter((token) => token.startsWith("&")).sort();
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
