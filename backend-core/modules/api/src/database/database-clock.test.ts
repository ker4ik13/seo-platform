import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client.js";
import { databaseClock } from "./database-clock.js";

test("returns only a valid PostgreSQL clock", async () => {
  const now = new Date("2026-08-04T20:00:00.000Z");
  const client = {
    $queryRaw: async () => [{ now }]
  } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
  assert.equal(await databaseClock(client), now);
});

test("rejects a malformed PostgreSQL clock", async () => {
  const client = {
    $queryRaw: async () => []
  } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
  await assert.rejects(databaseClock(client), /Database clock/u);
});
