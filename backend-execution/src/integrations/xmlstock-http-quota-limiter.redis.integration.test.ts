import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Redis } from "ioredis";
import {
  acquireXmlStockHttpQuotaPermit,
  releaseXmlStockHttpQuotaPermit,
  type XmlStockHttpProduct,
  type XmlStockHttpQuotaPermit
} from "./xmlstock-http-quota-limiter.js";

const redisBinary = process.env.XMLSTOCK_TEST_REDIS_BINARY;
const firstKey = "01900000-0000-7000-8000-000000000001";
const secondKey = "01900000-0000-7000-8000-000000000002";
const thirdKey = "01900000-0000-7000-8000-000000000003";
const fourthKey = "01900000-0000-7000-8000-000000000004";
const fifthKey = "01900000-0000-7000-8000-000000000005";
const firstWorkspace = "01900000-0000-7000-8000-000000000011";
const secondWorkspace = "01900000-0000-7000-8000-000000000012";

test("XMLStock Redis quota shares a physical key and fairly lends global slots", {
  skip: !redisBinary,
  timeout: 25_000
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-xmlstock-quota-"));
  const socket = join(directory, "redis.sock");
  const server = spawn(redisBinary!, [
    "--port", "0", "--unixsocket", socket,
    "--save", "", "--appendonly", "no", "--dir", directory,
    "--loglevel", "warning"
  ], { stdio: "ignore" });
  let redis: Redis | undefined;
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await stat(socket);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    redis = new Redis({ path: socket, lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    const take = (
      credentialId: string,
      product: XmlStockHttpProduct,
      globalConcurrency: number,
      workspaceId = credentialId === secondKey ? secondWorkspace : firstWorkspace
    ) => acquireXmlStockHttpQuotaPermit(redis!, {
      credentialId, workspaceId, product, globalConcurrency, leaseMs: 10_000,
      member: randomUUID()
    });
    const release = (permit: XmlStockHttpQuotaPermit) =>
      permit.allowed ? releaseXmlStockHttpQuotaPermit(redis!, permit) : Promise.resolve();

    const livePermits: XmlStockHttpQuotaPermit[] = [];
    for (let index = 0; index < 10; index += 1) {
      const permit = await take(firstKey, "YANDEX_LIVE", 20);
      assert.equal(permit.allowed, true);
      livePermits.push(permit);
      await new Promise((resolve) => setTimeout(resolve, 105));
    }
    assert.equal((await take(firstKey, "YANDEX_LIVE", 20)).allowed, false);
    assert.equal((await take(firstKey, "YANDEX_LIVE", 20, secondWorkspace)).allowed, false);
    await Promise.all(livePermits.splice(5).map(release));
    assert.equal((await take(firstKey, "YANDEX_LIVE", 20)).allowed, false);
    const secondWorkspacePermits: XmlStockHttpQuotaPermit[] = [];
    for (let index = 0; index < 5; index += 1) {
      let permit: XmlStockHttpQuotaPermit | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        permit = await take(firstKey, "YANDEX_LIVE", 20, secondWorkspace);
        if (permit.allowed) break;
        await new Promise((resolve) => setTimeout(resolve, 110));
      }
      assert.equal(permit?.allowed, true);
      secondWorkspacePermits.push(permit!);
    }
    await Promise.all([...livePermits, ...secondWorkspacePermits].map(release));

    const first: XmlStockHttpQuotaPermit[] = [];
    for (let index = 0; index < 4; index += 1) {
      const permit = await take(firstKey, "YANDEX_SEARCH_API", 4);
      assert.equal(permit.allowed, true);
      first.push(permit);
    }
    assert.equal((await take(secondKey, "GOOGLE_LIVE", 4)).allowed, false);
    await release(first.pop()!);
    assert.equal((await take(firstKey, "YANDEX_SEARCH_API", 4)).allowed, false);
    const second: XmlStockHttpQuotaPermit[] = [];
    for (let index = 0; index < 2; index += 1) {
      if (index === 1) await release(first.pop()!);
      const permit = await take(secondKey, "GOOGLE_LIVE", 4);
      assert.equal(permit.allowed, true);
      second.push(permit);
    }
    assert.equal((await take(firstKey, "YANDEX_SEARCH_API", 4)).allowed, false);
    await release(second.pop()!);
    const borrowed = await take(firstKey, "YANDEX_SEARCH_API", 4);
    assert.equal(borrowed.allowed, true);
    await Promise.all([...first, ...second, borrowed].map(release));

    const mixed = await Promise.all([
      take(thirdKey, "YANDEX_LIVE", 4),
      take(fourthKey, "YANDEX_SEARCH_API", 4),
      take(fifthKey, "GOOGLE_LIVE", 4)
    ]);
    assert.ok(mixed.every((permit) => permit.allowed));
    const spareSlot = await take(fourthKey, "YANDEX_SEARCH_API", 4);
    assert.equal(spareSlot.allowed, true, "an idle fourth slot remains available to an active key");
    await Promise.all([...mixed, spareSlot].map(release));
  } finally {
    await redis?.quit().catch(() => undefined);
    server.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});
