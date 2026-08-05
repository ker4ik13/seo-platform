import { Injectable } from "@nestjs/common";
import type {
  BillingLedgerAccountType,
  BillingLedgerDirection,
  BillingLedgerTransactionType,
  Prisma
} from "../generated/prisma/client.js";
import { uuidV7 } from "../common/uuid-v7.js";

export interface BillingLedgerPostInput {
  readonly type: BillingLedgerTransactionType;
  readonly businessReference: string;
  readonly description: string;
  readonly occurredAt: Date;
  readonly createdBy?: string;
  readonly metadata: Prisma.InputJsonValue;
  readonly reversalOfId?: string;
  readonly entries: readonly {
    readonly workspaceId?: string;
    readonly accountType: BillingLedgerAccountType;
    readonly direction: BillingLedgerDirection;
    readonly amountMinor: bigint;
  }[];
}

interface BalanceRow {
  readonly account_type: BillingLedgerAccountType;
  readonly balance_minor: bigint;
  readonly updated_at: Date | null;
}

@Injectable()
export class BillingLedgerService {
  public async post(
    transaction: Prisma.TransactionClient,
    input: BillingLedgerPostInput
  ): Promise<string> {
    const existing =
      await transaction.billingLedgerTransaction.findUnique({
        where: { businessReference: input.businessReference },
        select: { id: true, status: true }
      });
    if (existing) {
      if (existing.status !== "POSTED") {
        throw new Error("Existing billing ledger transaction is not posted");
      }
      return existing.id;
    }
    if (input.entries.length < 2) {
      throw new Error("A ledger transaction requires at least two entries");
    }
    const debit = total(input.entries, "DEBIT");
    const credit = total(input.entries, "CREDIT");
    if (debit <= 0n || debit !== credit) {
      throw new Error("Ledger transaction entries must balance");
    }

    const ledgerTransactionId = uuidV7();
    await transaction.billingLedgerTransaction.create({
      data: {
        id: ledgerTransactionId,
        type: input.type,
        businessReference: input.businessReference,
        description: input.description,
        occurredAt: input.occurredAt,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
        metadata: input.metadata,
        ...(input.reversalOfId
          ? { reversalOfId: input.reversalOfId }
          : {})
      }
    });
    const entries = [];
    for (const entry of input.entries) {
      if (entry.amountMinor <= 0n) {
        throw new Error("Ledger entry amount must be positive");
      }
      const accountId = await this.accountId(
        transaction,
        entry.accountType,
        entry.workspaceId
      );
      entries.push({
        transactionId: ledgerTransactionId,
        accountId,
        direction: entry.direction,
        amountMinor: entry.amountMinor,
        currency: "RUB"
      });
    }
    await transaction.billingLedgerEntry.createMany({ data: entries });
    await transaction.billingLedgerTransaction.update({
      where: { id: ledgerTransactionId },
      data: { status: "POSTED" }
    });
    return ledgerTransactionId;
  }

  public async balance(
    transaction: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<{
    readonly prepaidMinor: bigint;
    readonly includedCreditsMinor: bigint;
    readonly updatedAt?: Date;
  }> {
    const rows = await transaction.$queryRaw<BalanceRow[]>`
      SELECT
        account."type" AS account_type,
        COALESCE(
          SUM(
            CASE entry."direction"
              WHEN 'CREDIT' THEN entry."amount_minor"
              ELSE -entry."amount_minor"
            END
          ),
          0
        )::bigint AS balance_minor,
        MAX(entry."created_at") AS updated_at
      FROM "billing_ledger_accounts" account
      LEFT JOIN "billing_ledger_entries" entry
        ON entry."account_id" = account."id"
      WHERE account."workspace_id" = ${workspaceId}::uuid
        AND account."currency" = 'RUB'
        AND account."type" IN (
          'CUSTOMER_PREPAID_LIABILITY',
          'PROMOTIONAL_LIABILITY'
        )
      GROUP BY account."type"
    `;
    const prepaid = rows.find(
      (row) => row.account_type === "CUSTOMER_PREPAID_LIABILITY"
    );
    const promotional = rows.find(
      (row) => row.account_type === "PROMOTIONAL_LIABILITY"
    );
    const updatedAt = latest(prepaid?.updated_at, promotional?.updated_at);
    return {
      prepaidMinor: prepaid?.balance_minor ?? 0n,
      includedCreditsMinor: promotional?.balance_minor ?? 0n,
      ...(updatedAt ? { updatedAt } : {})
    };
  }

  private async accountId(
    transaction: Prisma.TransactionClient,
    type: BillingLedgerAccountType,
    workspaceId?: string
  ): Promise<string> {
    if (workspaceId) {
      const account = await transaction.billingLedgerAccount.upsert({
        where: {
          workspaceId_type_currency: {
            workspaceId,
            type,
            currency: "RUB"
          }
        },
        create: { workspaceId, type, currency: "RUB" },
        update: {},
        select: { id: true }
      });
      return account.id;
    }
    const account = await transaction.billingLedgerAccount.findFirst({
      where: { workspaceId: null, type, currency: "RUB", status: "ACTIVE" },
      select: { id: true }
    });
    if (!account) {
      throw new Error(`Platform billing account ${type} is missing`);
    }
    return account.id;
  }
}

function total(
  entries: BillingLedgerPostInput["entries"],
  direction: BillingLedgerDirection
): bigint {
  return entries.reduce(
    (sum, entry) =>
      entry.direction === direction ? sum + entry.amountMinor : sum,
    0n
  );
}

function latest(
  left: Date | null | undefined,
  right: Date | null | undefined
): Date | undefined {
  if (!left) return right ?? undefined;
  if (!right) return left;
  return left > right ? left : right;
}
