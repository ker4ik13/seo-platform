import type { Prisma } from "../generated/prisma/client.js";

type DatabaseClockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function databaseClock(
  client: DatabaseClockClient
): Promise<Date> {
  const [clock] = await client.$queryRaw<
    readonly { readonly now: Date }[]
  >`SELECT clock_timestamp() AS "now"`;
  if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime())) {
    throw new Error("Database clock returned an invalid value");
  }
  return clock.now;
}
