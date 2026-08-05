import type { Prisma } from "../generated/prisma/client.js";

type DatabaseClockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Reads the authoritative wall clock from PostgreSQL. Lease, retry and paid
 * execution decisions must not depend on the clock of an individual worker.
 */
export async function databaseClock(
  client: DatabaseClockClient,
  failureMessage = "Unable to read database clock"
): Promise<Date> {
  const [clock] = await client.$queryRaw<
    readonly { readonly now: Date }[]
  >`SELECT clock_timestamp() AS "now"`;
  if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime())) {
    throw new Error(failureMessage);
  }
  return clock.now;
}
