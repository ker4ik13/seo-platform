import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { QueueKeys, type ConnectionOptions } from "bullmq";
import {
  bullMqConnectionOptions,
  JOBS_BULLMQ_PREFIX
} from "./bullmq-keyspace.js";

const sourceDirectoryUrl = new URL("../", import.meta.url);
const sourceDirectoryPath = fileURLToPath(sourceDirectoryUrl);
const expectedConstructionSites = new Map([
  ["automations/automation-runtime.service.ts", 1],
  ["connector-worker.main.ts", 3],
  ["crawl-worker.main.ts", 2],
  ["import-worker.main.ts", 2],
  ["inspection-worker.main.ts", 2],
  ["queue/queue.service.ts", 7],
  ["rank-worker.main.ts", 2],
  ["worker.main.ts", 1]
]);

test("uses one versioned BullMQ prefix without an ioredis keyPrefix", () => {
  const connection = Object.freeze({}) as ConnectionOptions;
  const options = bullMqConnectionOptions(connection);

  assert.equal(JOBS_BULLMQ_PREFIX, "seo-platform:jobs:v1");
  assert.equal(options.connection, connection);
  assert.equal(options.prefix, JOBS_BULLMQ_PREFIX);
  assert.deepEqual(Object.keys(options).sort(), ["connection", "prefix"]);
  assert.equal("keyPrefix" in options, false);
  assert.equal("keyPrefix" in connection, false);

  const keys = new QueueKeys(JOBS_BULLMQ_PREFIX);
  assert.equal(
    keys.getQueueQualifiedName("rank-preparation"),
    "seo-platform:jobs:v1:rank-preparation"
  );
  assert.equal(
    keys.toKey("rank-preparation", "wait"),
    "seo-platform:jobs:v1:rank-preparation:wait"
  );
  assert.equal(
    keys.toKey("rank-automation", "wait"),
    "seo-platform:jobs:v1:rank-automation:wait"
  );
});

test("wires the shared prefix into every BullMQ process role", async () => {
  const actualConstructionSites = new Map<string, number>();

  for (const fileUrl of await productionTypeScriptFiles(sourceDirectoryUrl)) {
    const source = await readFile(fileUrl, "utf8");
    const relativePath = relative(
      sourceDirectoryPath,
      fileURLToPath(fileUrl)
    ).replaceAll("\\", "/");
    assert.equal(
      source.includes("keyPrefix"),
      false,
      `${relativePath} must not configure the ioredis keyPrefix option`
    );

    const constructionCount = countMatches(
      source,
      /\bnew\s+(?:Queue|Worker|QueueEvents|FlowProducer|JobScheduler)(?:<[^>]+>)?\s*\(/gu
    );
    if (constructionCount === 0) continue;

    const prefixHelperCount = countMatches(
      source,
      /\bbullMqConnectionOptions\s*\(/gu
    );
    assert.equal(
      prefixHelperCount,
      constructionCount,
      `${relativePath} must apply bullMqConnectionOptions once per BullMQ constructor`
    );
    actualConstructionSites.set(relativePath, constructionCount);
  }

  assert.deepEqual(
    sortedEntries(actualConstructionSites),
    sortedEntries(expectedConstructionSites)
  );
});

async function productionTypeScriptFiles(directoryUrl: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "generated") continue;
      files.push(
        ...(await productionTypeScriptFiles(
          new URL(`${entry.name}/`, directoryUrl)
        ))
      );
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(new URL(entry.name, directoryUrl));
    }
  }
  return files;
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function sortedEntries(
  entries: ReadonlyMap<string, number>
): [string, number][] {
  return [...entries].sort(([left], [right]) => left.localeCompare(right));
}
