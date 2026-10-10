import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { ProjectNoteService } from "./project-note.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const noteId = "01900000-0000-7000-8000-000000000004";

test("creates an opaque public token only for public notes", async () => {
  let createData: Readonly<Record<string, unknown>> | undefined;
  const service = new ProjectNoteService({
    projectNote: {
      create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        createData = data;
        return row({
          title: String(data.title),
          markdown: String(data.markdown),
          visibility: "PUBLIC",
          publicToken: String(data.publicToken)
        });
      }
    }
  } as unknown as PrismaService);

  const note = await service.create({
    workspaceId,
    projectId,
    actorId,
    title: "План",
    markdown: "# План",
    visibility: "PUBLIC"
  });

  assert.match(String(createData?.publicToken), /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(note.publicToken, createData?.publicToken);
});

test("revokes a public token when a note becomes member-only", async () => {
  let updateData: unknown;
  let reads = 0;
  const service = new ProjectNoteService({
    projectNote: {
      findFirst: async () => {
        reads += 1;
        return reads === 1
          ? row({ visibility: "PUBLIC", publicToken: "a".repeat(43) })
          : row({ visibility: "PROJECT_MEMBERS", publicToken: null, version: 2 });
      },
      updateMany: async ({ data }: { data: unknown }) => {
        updateData = data;
        return { count: 1 };
      }
    }
  } as unknown as PrismaService);

  const note = await service.update(noteId, {
    workspaceId,
    projectId,
    actorId,
    version: 1,
    visibility: "PROJECT_MEMBERS"
  });

  assert.deepEqual(updateData, {
    delimiter: null,
    visibility: "PROJECT_MEMBERS",
    publicToken: null,
    updatedBy: actorId,
    version: { increment: 1 }
  });
  assert.equal(note.visibility, "PROJECT_MEMBERS");
  assert.equal(note.publicToken, undefined);
});

function row(
  patch: Partial<{
    title: string;
    markdown: string;
    visibility: "PROJECT_MEMBERS" | "PUBLIC";
    publicToken: string | null;
    version: number;
  }> = {}
) {
  const createdAt = new Date("2026-08-09T10:00:00.000Z");
  return {
    id: noteId,
    workspaceId,
    projectId,
    title: patch.title ?? "План",
    format: "MARKDOWN" as const,
    delimiter: null,
    markdown: patch.markdown ?? "# План",
    visibility: patch.visibility ?? "PROJECT_MEMBERS",
    publicToken: patch.publicToken ?? null,
    createdBy: actorId,
    updatedBy: actorId,
    version: patch.version ?? 1,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null
  };
}

test("rejects conversion of malformed CSV before any persisted update", async () => {
  let writes = 0;
  const service = new ProjectNoteService({ projectNote: {
    findFirst: async () => ({ ...row(), format: "CSV", delimiter: ",", markdown: '"unfinished' }),
    updateMany: async () => { writes++; return { count: 1 }; }
  } } as unknown as PrismaService);
  await assert.rejects(service.update(noteId, { workspaceId, projectId, actorId, version: 1, delimiter: ";" }), (error: unknown) => {
    return error instanceof Error && "getStatus" in error && (error as { getStatus: () => number }).getStatus() === 400;
  });
  assert.equal(writes, 0);
});
