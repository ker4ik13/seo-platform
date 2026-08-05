import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client.js";
import { databaseClock } from "./database-clock.js";

test("returns the authoritative PostgreSQL clock", async () => {
  const now = new Date("2026-08-04T20:00:00.000Z");
  const client = {
    $queryRaw: async () => [{ now }]
  } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;

  assert.equal(await databaseClock(client), now);
});

test("fails closed when PostgreSQL returns an invalid clock", async () => {
  const client = {
    $queryRaw: async () => [{ now: "not-a-date" }]
  } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;

  await assert.rejects(
    databaseClock(client, "clock unavailable"),
    /clock unavailable/u
  );
});
