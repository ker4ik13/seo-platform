import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { PlatformAdminReadService } from "./platform-admin-read.service.js";

const firstProjectId = "01900000-0000-7000-8000-000000000001";
const secondProjectId = "01900000-0000-7000-8000-000000000002";

test("counts active keywords and user-created folders for every requested project", async () => {
  let keywordQuery: unknown;
  let folderQuery: unknown;
  const service = new PlatformAdminReadService({
    keyword: {
      groupBy: async (query: unknown) => {
        keywordQuery = query;
        return [{ projectId: firstProjectId, _count: { _all: 12 } }];
      }
    },
    keywordGroup: {
      groupBy: async (query: unknown) => {
        folderQuery = query;
        return [{ projectId: firstProjectId, _count: { _all: 3 } }];
      }
    }
  } as unknown as PrismaService);

  assert.deepEqual(
    await service.projectCounts([firstProjectId, secondProjectId]),
    [
      { projectId: firstProjectId, keywordCount: 12, folderCount: 3 },
      { projectId: secondProjectId, keywordCount: 0, folderCount: 0 }
    ]
  );
  assert.deepEqual(keywordQuery, {
    by: ["projectId"],
    where: {
      projectId: { in: [firstProjectId, secondProjectId] },
      status: "ACTIVE",
      deletedAt: null
    },
    _count: { _all: true }
  });
  assert.deepEqual(folderQuery, {
    by: ["projectId"],
    where: {
      projectId: { in: [firstProjectId, secondProjectId] },
      status: "ACTIVE",
      systemKind: null
    },
    _count: { _all: true }
  });
});
