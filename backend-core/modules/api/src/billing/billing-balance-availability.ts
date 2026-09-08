import type { Prisma } from "../generated/prisma/client.js";

/** Legacy refunds reserved funds virtually. New approvals use the ledger;
 * their holds are already absent from prepaid balance and must not count twice. */
export async function spendablePrepaidMinor(tx: Prisma.TransactionClient, workspaceId: string, ledgerPrepaidMinor: bigint): Promise<bigint> {
  const pending = await tx.billingRefund.aggregate({ where: { workspaceId, refundRequestId: null, status: { in: ["CREATING", "PENDING", "FAILED_RETRYABLE"] }, payment: { order: { kind: "TOP_UP" } } }, _sum: { amountMinor: true } });
  const amount = ledgerPrepaidMinor - (pending._sum.amountMinor ?? 0n);
  return amount > 0n ? amount : 0n;
}
