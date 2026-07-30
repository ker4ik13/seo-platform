import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { KeywordGroupService } from "./keyword-group.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";

test("lists only tenant-scoped active groups with keyword counts", async () => {
  let observedWhere: unknown;
  const service = new KeywordGroupService({
    keywordGroup: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return [
          {
            id: "01900000-0000-7000-8000-000000000010",
            workspaceId,
            projectId,
            parentId: null,
            name: "Услуги",
            path: "Услуги",
            pathHash: "a".repeat(64),
            color: "#6758ef",
            position: 0,
            status: "ACTIVE" as const,
            version: 2,
            createdAt: new Date("2026-07-30T10:00:00Z"),
            updatedAt: new Date("2026-07-30T11:00:00Z"),
            _count: { memberships: 12 }
          }
        ];
      }
    }
  } as unknown as PrismaService);

  const result = await service.list(workspaceId, projectId);

  assert.deepEqual(observedWhere, {
    workspaceId,
    projectId,
    status: "ACTIVE"
  });
  assert.equal(result[0]?.path, "Услуги");
  assert.equal(result[0]?.keywordCount, 12);
  assert.equal(result[0]?.version, 2);
});
