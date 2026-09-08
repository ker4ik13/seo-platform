import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type {
  InternalChangeTrackingContextKeywordInput,
  InternalCreateTrackingContextInput,
  InternalReplaceTrackingContextKeywordsInput,
  InternalUpdateTrackingContextInput,
  TrackingContextConfigurationInput
} from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import { TrackingContextService } from "./tracking-context.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";

test("assignment advisory lock exposes a Prisma-supported scalar", async () => {
  const source = await readFile(
    new URL("./tracking-context.service.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /pg_advisory_xact_lock\([\s\S]*?\) IS NULL AS "lockResult"/u
  );
});

const configuration: TrackingContextConfigurationInput = {
  searchEngine: "GOOGLE",
  countryCode: "US",
  language: "en",
  device: "DESKTOP",
  depth: 100,
  domainMatchRule: { mode: "EXACT_HOST" },
  safeSearch: false
};

test("keeps imported rank contexts out of runnable settings", async () => {
  let observedWhere: unknown;
  const service = new TrackingContextService({
    trackingContext: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return [];
      }
    }
  } as unknown as PrismaService);

  assert.deepEqual(await service.list(workspaceId, projectId), {
    contexts: [],
    contextsTruncated: false
  });
  assert.deepEqual(observedWhere, {
    workspaceId,
    projectId,
    rankManifests: { none: { provider: { in: ["KEY_COLLECTOR", "MANUAL_IMPORT"] } } }
  });
});

test("replays the immutable create receipt and rejects key reuse", async () => {
  let receipt: Record<string, unknown> | undefined;
  const outbox: Array<Record<string, unknown>> = [];
  const createdAt = new Date("2026-07-29T09:00:00Z");
  const fake = {
    trackingContextCreateReceipt: {
      findUnique: async () => receipt,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        receipt = structuredClone(data);
        return receipt;
      }
    },
    trackingContext: {
      create: async ({
        data
      }: {
        data: Record<string, any>;
      }) => {
        const version = data.configurations.create;
        assert.equal("workspaceId" in version, false);
        assert.equal("projectId" in version, false);
        return {
          id: contextId,
          workspaceId,
          projectId,
          name: data.name,
          status: "ACTIVE",
          createdBy: actorId,
          updatedBy: actorId,
          archivedBy: null,
          version: 1,
          createdAt,
          updatedAt: createdAt,
          archivedAt: null,
          configurations: [
            {
              contextId,
              ...version,
              regionCode: null,
              regionLabel: null,
              domainMatchValue: null,
              createdAt
            }
          ],
          _count: { keywordAssignments: 0 }
        };
      }
    },
    outboxEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        outbox.push(data);
        return data;
      }
    }
  };
  const prisma = {
    ...fake,
    $transaction: async (work: (transaction: unknown) => unknown) =>
      work(fake)
  } as unknown as PrismaService;
  const service = new TrackingContextService(prisma);
  const command: InternalCreateTrackingContextInput = {
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "create-1",
    name: "United States desktop",
    configuration
  };

  const created = await service.create(command);
  const replayed = await service.create(command);

  assert.deepEqual(replayed, created);
  assert.equal(outbox.length, 1);
  const serializedEvent = JSON.stringify(outbox[0]);
  assert.doesNotMatch(serializedEvent, /United States desktop/u);
  assert.doesNotMatch(serializedEvent, /countryCode|domainMatchRule/u);

  await assert.rejects(
    () => service.create({ ...command, name: "Another context" }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 409
  );
});

test("rejects launch-profile groups outside the current project", async () => {
  let observedWhere: unknown;
  const transaction = {
    trackingContextCreateReceipt: {
      findUnique: async () => undefined
    },
    keywordGroup: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return [];
      }
    },
    trackingContext: {
      create: async () => {
        throw new Error("Context creation must not be reached");
      }
    }
  };
  const service = new TrackingContextService({
    trackingContextCreateReceipt: {
      findUnique: async () => undefined
    },
    $transaction: async (work: (value: unknown) => unknown) =>
      work(transaction)
  } as unknown as PrismaService);

  await assert.rejects(
    () =>
      service.create({
        workspaceId,
        projectId,
        actorId,
        idempotencyKey: "create-group-scope-1",
        name: "Folder-scoped context",
        configuration,
        launchProfile: {
          searchSource: "LIVE",
          includeUntracked: false,
          scope: {
            mode: "GROUPS",
            groupIds: ["01900000-0000-7000-8000-000000000099"]
          }
        }
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 400
  );
  assert.deepEqual(observedWhere, {
    workspaceId,
    projectId,
    id: { in: ["01900000-0000-7000-8000-000000000099"] },
    status: "ACTIVE",
    OR: [{ systemKind: null }, { systemKind: "UNGROUPED" }]
  });
});

test("rename keeps configuration immutable and config change appends a version", async () => {
  const state: any = aggregate();
  const versionCreates: Array<Record<string, any>> = [];
  const events: Array<Record<string, unknown>> = [];
  const transaction = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    trackingContext: {
      findFirst: async () => state,
      update: async ({ data }: { data: Record<string, any> }) => {
        if (typeof data.name === "string") state.name = data.name;
        state.updatedBy = String(data.updatedBy);
        state.version += 1;
        state.updatedAt = new Date(state.updatedAt.getTime() + 1_000);
        return state;
      }
    },
    trackingContextVersion: {
      create: async ({ data }: { data: Record<string, any> }) => {
        versionCreates.push(data);
        state.configurations.unshift({
          ...data,
          regionCode: data.regionCode ?? null,
          regionLabel: data.regionLabel ?? null,
          domainMatchValue: data.domainMatchValue ?? null,
          createdAt: new Date("2026-07-29T10:00:00Z")
        });
        return state.configurations[0];
      }
    },
    outboxEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      }
    }
  };
  const prisma = {
    $transaction: async (work: (value: unknown) => unknown) =>
      work(transaction)
  } as unknown as PrismaService;
  const service = new TrackingContextService(prisma);
  const base: InternalUpdateTrackingContextInput = {
    workspaceId,
    projectId,
    actorId,
    version: 1,
    name: "Renamed",
    configuration
  };

  const renamed = await service.update(contextId, base);
  assert.equal(renamed.version, 2);
  assert.equal(renamed.configuration.configurationVersion, 1);
  assert.equal(versionCreates.length, 0);

  const changed = await service.update(contextId, {
    ...base,
    version: 2,
    configuration: { ...configuration, device: "MOBILE" }
  });
  assert.equal(changed.version, 3);
  assert.equal(changed.configuration.configurationVersion, 2);
  assert.equal(changed.configuration.device, "MOBILE");
  assert.equal(versionCreates.length, 1);
  assert.equal(events.length, 2);

  await assert.rejects(
    () =>
      service.update(contextId, {
        ...base,
        version: 2,
        configuration: { ...configuration, device: "MOBILE" }
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 412
  );
});

test("point assignments are temporal and naturally idempotent", async () => {
  let activeAssignment:
    | {
        id: string;
        assignedAt: Date;
        removedAt: Date | null;
      }
    | undefined;
  let createdAssignments = 0;
  let removedAssignments = 0;
  const events: unknown[] = [];
  const transaction = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    trackingContext: {
      findFirst: async () => ({ status: "ACTIVE" })
    },
    keyword: {
      findFirst: async () => ({ id: keywordId })
    },
    trackingContextKeywordAssignment: {
      count: async () => 0,
      findFirst: async () =>
        activeAssignment?.removedAt ? undefined : activeAssignment,
      create: async ({ data }: { data: Record<string, any> }) => {
        createdAssignments += 1;
        activeAssignment = {
          id: `01900000-0000-7000-8000-${String(createdAssignments).padStart(12, "0")}`,
          assignedAt: data.assignedAt,
          removedAt: null
        };
        return activeAssignment;
      },
      update: async ({ data }: { data: Record<string, any> }) => {
        removedAssignments += 1;
        activeAssignment!.removedAt = data.removedAt;
        return activeAssignment;
      }
    },
    outboxEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      }
    }
  };
  const prisma = {
    $transaction: async (work: (value: unknown) => unknown) =>
      work(transaction)
  } as unknown as PrismaService;
  const service = new TrackingContextService(prisma);
  const input: InternalChangeTrackingContextKeywordInput = {
    workspaceId,
    projectId,
    contextId,
    keywordId,
    actorId,
    entitlement: {
      planCode: "TEAM",
      planVersion: 1,
      storedKeywords: 2_000_000,
      keywordsPerProject: 2_000_000,
      foldersPerProject: 500,
      trackedContextPairs: 50_000
    }
  };

  const assigned = await service.assignKeyword(input);
  const assignedReplay = await service.assignKeyword(input);
  const removed = await service.removeKeyword(input);
  const removedReplay = await service.removeKeyword(input);

  assert.equal(assigned.assigned, true);
  assert.deepEqual(assignedReplay, assigned);
  assert.equal(removed.assigned, false);
  assert.deepEqual(removedReplay, {
    contextId,
    keywordId,
    assigned: false
  });
  assert.equal(createdAssignments, 1);
  assert.equal(removedAssignments, 1);
  assert.equal(events.length, 2);
});

test("bulk replacement is atomic, versioned and replay-safe without per-key events", async () => {
  const replacementKeywordIds = Array.from(
    { length: 15_000 },
    (_, index) => keywordIdAt(index + 5)
  );
  const secondKeywordId = replacementKeywordIds[1]!;
  const currentAssignmentId = "01900000-0000-7000-8000-000000000007";
  const state: any = aggregate();
  let receipt: Record<string, any> | undefined;
  let createdAssignments = 0;
  const createBatchSizes: number[] = [];
  let removedAssignments = 0;
  let capacityReads = 0;
  const events: Array<Record<string, any>> = [];
  const transaction = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    trackingContextKeywordReplaceReceipt: {
      findUnique: async () => receipt,
      create: async ({ data }: { data: Record<string, any> }) => {
        receipt = structuredClone(data);
        return receipt;
      }
    },
    trackingContext: {
      findFirst: async () => state,
      update: async () => {
        state.version += 1;
        return { version: state.version };
      }
    },
    keyword: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        replacementKeywordIds.filter(id => where.id.in.includes(id)).map((id) => ({ id }))
    },
    trackingContextKeywordAssignment: {
      findMany: async () => [
        {
          id: currentAssignmentId,
          keywordId
        }
      ],
      count: async () => {
        capacityReads += 1;
        return 10;
      },
      updateMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        removedAssignments += where.id.in.length;
        return { count: where.id.in.length };
      },
      createMany: async ({ data }: { data: readonly unknown[] }) => {
        createBatchSizes.push(data.length);
        createdAssignments += data.length;
        return { count: data.length };
      }
    },
    outboxEvent: {
      create: async ({ data }: { data: Record<string, any> }) => {
        events.push(data);
        return data;
      }
    }
  };
  const service = new TrackingContextService({
    trackingContextKeywordReplaceReceipt: {
      findUnique: async () => receipt
    },
    $transaction: async (work: (value: unknown) => unknown) =>
      work(transaction)
  } as unknown as PrismaService);
  const input: InternalReplaceTrackingContextKeywordsInput = {
    workspaceId,
    projectId,
    contextId,
    actorId,
    version: 1,
    idempotencyKey: "replace-keywords-001",
    keywordIds: replacementKeywordIds,
    entitlement: {
      planCode: "TEAM",
      planVersion: 1,
      storedKeywords: 2_000_000,
      keywordsPerProject: 2_000_000,
      foldersPerProject: 500,
      trackedContextPairs: 50_000
    }
  };

  const result = await service.replaceKeywords(input);
  const replay = await service.replaceKeywords(input);

  assert.deepEqual(replay, result);
  assert.equal(result.assignedKeywordCount, 15_000);
  assert.equal(result.addedKeywordCount, 14_999);
  assert.equal(result.removedKeywordCount, 0);
  assert.equal(result.unchangedKeywordCount, 1);
  assert.equal(result.version, 2);
  assert.match(result.keywordSetHash.value, /^[0-9a-f]{64}$/u);
  assert.equal(createdAssignments, 14_999);
  assert.deepEqual(createBatchSizes, [5_000, 5_000, 4_999]);
  assert.ok(createBatchSizes.every((size) => size <= 5_000));
  assert.equal(removedAssignments, 0);
  assert.equal(capacityReads, 1);
  assert.equal(events.length, 1);
  assert.equal(
    events[0]?.eventType,
    "seo.tracking-context.keyword-assignments.replaced.v1"
  );
  assert.doesNotMatch(JSON.stringify(events[0]), new RegExp(secondKeywordId));

  await assert.rejects(
    () =>
      service.replaceKeywords({
        ...input,
        keywordIds: [keywordId]
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 409
  );
});

function keywordIdAt(value: number): string {
  return `01900000-0000-7000-8000-${value
    .toString(16)
    .padStart(12, "0")}`;
}

test("archive and restore use entity CAS without changing configuration", async () => {
  const state: any = aggregate();
  const events: unknown[] = [];
  const transaction = {
    $queryRaw: async () => [],
    trackingContext: {
      findFirst: async () => state,
      update: async ({ data }: { data: Record<string, any> }) => {
        state.status = data.status;
        state.updatedBy = data.updatedBy;
        state.version += 1;
        state.updatedAt = new Date(state.updatedAt.getTime() + 1_000);
        state.archivedBy = data.archivedBy ?? null;
        state.archivedAt = data.archivedAt ?? null;
        return state;
      }
    },
    outboxEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      }
    }
  };
  const service = new TrackingContextService({
    $transaction: async (work: (value: unknown) => unknown) =>
      work(transaction)
  } as unknown as PrismaService);
  const scope = { workspaceId, projectId, actorId };

  const archived = await service.archive(contextId, {
    ...scope,
    version: 1
  });
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.version, 2);
  assert.equal(archived.configuration.configurationVersion, 1);
  assert.ok(archived.archivedAt);

  await assert.rejects(
    () => service.archive(contextId, { ...scope, version: 2 }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 409
  );

  const restored = await service.restore(contextId, {
    ...scope,
    version: 2
  });
  assert.equal(restored.status, "ACTIVE");
  assert.equal(restored.version, 3);
  assert.equal(restored.archivedAt, undefined);
  assert.equal(events.length, 2);
});

test("rejects a forged assignment cursor before a UUID database comparison", async () => {
  const service = new TrackingContextService({
    trackingContext: {
      findFirst: async () => ({ id: contextId })
    },
    trackingContextKeywordAssignment: {
      findMany: async () => {
        throw new Error("Database query must not be reached");
      }
    }
  } as unknown as PrismaService);
  const cursor = Buffer.from(
    JSON.stringify({
      version: 1,
      contextId,
      search: "",
      assignedAt: "2026-07-29T09:00:00.000Z",
      id: "not-a-uuid"
    }),
    "utf8"
  ).toString("base64url");

  await assert.rejects(
    () =>
      service.listKeywords(
        workspaceId,
        projectId,
        contextId,
        { limit: 100, cursor },
        "request-1"
      ),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 400
  );
});

function aggregate() {
  const createdAt = new Date("2026-07-29T09:00:00Z");
  return {
    id: contextId,
    workspaceId,
    projectId,
    name: "Original",
    status: "ACTIVE" as const,
    createdBy: actorId,
    updatedBy: actorId,
    archivedBy: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    configurations: [
      {
        workspaceId,
        projectId,
        contextId,
        configurationVersion: 1,
        searchEngine: "GOOGLE" as const,
        countryCode: "US",
        regionCode: null,
        regionLabel: null,
        language: "en",
        device: "DESKTOP" as const,
        depth: 100,
        domainMatchMode: "EXACT_HOST" as const,
        domainMatchValue: null,
        safeSearch: false,
        configurationHash:
          "82e3249e68ce06735037840ff5ca6f118a0f49f0e5da0d098e5868741c02110b",
        createdBy: actorId,
        createdAt
      }
    ],
    _count: { keywordAssignments: 0 }
  };
}
