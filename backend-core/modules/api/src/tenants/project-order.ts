import type { Prisma } from "../generated/prisma/client.js";

export interface LockedWorkspaceOrder {
  readonly id: string;
  readonly status: string;
}

export async function lockWorkspaceProjectOrders(
  transaction: Prisma.TransactionClient,
  workspaceIds: readonly string[]
): Promise<readonly LockedWorkspaceOrder[]> {
  const ids = [...new Set(workspaceIds)].sort();
  if (ids.length === 0) return [];
  return transaction.$queryRaw<readonly LockedWorkspaceOrder[]>`
    SELECT "id"::text AS "id", "status"::text AS "status"
    FROM "workspaces"
    WHERE "id" IN (
      SELECT value::uuid
      FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
    )
    ORDER BY "id" ASC
    FOR UPDATE
  `;
}

export async function nextProjectDisplayOrder(
  transaction: Prisma.TransactionClient,
  workspaceId: string
): Promise<number> {
  const result = await transaction.project.aggregate({
    where: { workspaceId },
    _max: { displayOrder: true }
  });
  return (result._max.displayOrder ?? -1) + 1;
}
