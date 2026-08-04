import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";

const USER_LOCK_NAMESPACE = "web-push:user";

export async function acquireWebPushUserLock(
  transaction: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const key = advisoryKey(USER_LOCK_NAMESPACE, userId);
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${key[0]}::integer,
      ${key[1]}::integer
    ) IS NULL AS "lockResult"
  `;
}

export function webPushAdvisoryKey(
  namespace: string,
  value: string
): readonly [number, number] {
  return advisoryKey(namespace, value);
}

export async function acquireWebPushAdvisoryLock(
  transaction: Prisma.TransactionClient,
  key: readonly [number, number]
): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${key[0]}::integer,
      ${key[1]}::integer
    ) IS NULL AS "lockResult"
  `;
}

function advisoryKey(
  namespace: string,
  value: string
): readonly [number, number] {
  const digest = createHash("sha256")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}
