import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { SemanticSavedViewService } from "./semantic-saved-view.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const viewId = "01900000-0000-7000-8000-000000000004";
const config = {
  schemaVersion: 1 as const,
  filters: {},
  sort: "CREATED_DESC" as const,
  columns: ["query" as const],
  density: "COMFORTABLE" as const
};

test("lists only the actor private views and project-shared views", async () => {
  let observedWhere: unknown;
  const service = new SemanticSavedViewService({
    semanticSavedView: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return [row()];
      }
    }
  } as unknown as PrismaService);

  const result = await service.list(workspaceId, projectId, actorId);

  assert.deepEqual(observedWhere, {
    workspaceId,
    projectId,
    status: "ACTIVE",
    OR: [{ scope: "PROJECT_SHARED" }, { ownerId: actorId }]
  });
  assert.equal(result[0]?.name, "Основное");
});

test("rejects stale saved-view updates with the current version", async () => {
  const service = new SemanticSavedViewService({
    semanticSavedView: {
      findFirst: async () => row(),
      updateMany: async () => ({ count: 0 })
    }
  } as unknown as PrismaService);

  await assert.rejects(
    () =>
      service.update(viewId, {
        workspaceId,
        projectId,
        actorId,
        version: 1,
        name: "Новое имя"
      }),
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.PRECONDITION_FAILED &&
      (
        error.getResponse() as Readonly<Record<string, unknown>>
      ).currentVersion === 2
  );
});

function row() {
  return {
    id: viewId,
    workspaceId,
    projectId,
    ownerId: actorId,
    scope: "PRIVATE" as const,
    name: "Основное",
    normalizedName: "основное",
    config,
    status: "ACTIVE" as const,
    version: 2,
    createdAt: new Date("2026-07-30T10:00:00Z"),
    updatedAt: new Date("2026-07-30T11:00:00Z"),
    deletedAt: null
  };
}
