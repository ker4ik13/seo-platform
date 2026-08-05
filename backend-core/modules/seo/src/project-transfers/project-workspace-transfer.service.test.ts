import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import { ProjectWorkspaceTransferService } from "./project-workspace-transfer.service.js";

test("runs the tenant re-key routine inside bounded transaction settings", async () => {
  const statements: string[] = [];
  const transaction = {
    $executeRaw: async (parts: TemplateStringsArray) => {
      statements.push(parts.join("?"));
      return 0;
    },
    $queryRaw: async (parts: TemplateStringsArray) => {
      statements.push(parts.join("?"));
      return [{ affectedRows: 17n }];
    }
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: async (
      callback: (client: Prisma.TransactionClient) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const service = new ProjectWorkspaceTransferService(prisma);

  assert.deepEqual(
    await service.transfer(
      "01900000-0000-7000-8000-000000000001",
      "01900000-0000-7000-8000-000000000002",
      "01900000-0000-7000-8000-000000000003"
    ),
    { status: "TRANSFERRED", affectedRows: 17 }
  );
  assert.match(statements[0] ?? "", /SET LOCAL lock_timeout/u);
  assert.match(statements[1] ?? "", /SET LOCAL statement_timeout/u);
  assert.match(statements[2] ?? "", /transfer_seo_project_workspace/u);
});
