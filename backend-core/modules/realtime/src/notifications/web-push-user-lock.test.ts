import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client.js";
import {
  acquireWebPushAdvisoryLock,
  acquireWebPushUserLock
} from "./web-push-user-lock.js";

test("projects advisory lock void results to a Prisma-supported boolean", async () => {
  const queries: string[] = [];
  const transaction = {
    $queryRaw: async (
      strings: TemplateStringsArray,
      ..._values: readonly unknown[]
    ) => {
      queries.push(strings.join("?"));
      return [{ lockResult: false }];
    }
  } as unknown as Prisma.TransactionClient;

  await acquireWebPushUserLock(
    transaction,
    "019fc000-0000-7000-8000-000000000001"
  );
  await acquireWebPushAdvisoryLock(transaction, [1, 2]);

  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query, /pg_advisory_xact_lock/u);
    assert.match(query, /IS NULL AS "lockResult"/u);
  }
});
