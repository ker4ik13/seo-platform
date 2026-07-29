import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type {
  InternalChangeTrackingContextKeywordInput,
  InternalCreateTrackingContextInput,
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

const configuration: TrackingContextConfigurationInput = {
  searchEngine: "GOOGLE",
  countryCode: "US",
  language: "en",
  device: "DESKTOP",
  depth: 100,
  domainMatchRule: { mode: "EXACT_HOST" },
  safeSearch: false
};

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

test("rename keeps configuration immutable and config change appends a version", async () => {
  const state: any = aggregate();
  const versionCreates: Array<Record<string, any>> = [];
  const events: Array<Record<string, unknown>> = [];
  const transaction = {
    $queryRaw: async () => [],
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
    trackingContext: {
      findFirst: async () => ({ status: "ACTIVE" })
    },
    keyword: {
      findFirst: async () => ({ id: keywordId })
    },
    trackingContextKeywordAssignment: {
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
    actorId
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
