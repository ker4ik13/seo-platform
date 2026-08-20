import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import type { PrismaService } from "../database/prisma.service.js";
import { ProjectPresenceService } from "./project-presence.service.js";

const WORKSPACE_ID = "0198f258-8cc7-7abc-8def-1234567890ae";
const PROJECT_ID = "0198f258-8cc7-7abc-8def-1234567890af";
const USER_ID = "0198f258-8cc7-7abc-8def-1234567890ab";

test("lists only active members with project access and safe profile fields", async () => {
  let query: unknown;
  const service = new ProjectPresenceService({
    workspaceMember: {
      findMany: async (candidate: unknown) => {
        query = candidate;
        return [
          {
            userId: USER_ID,
            user: {
              displayName: "Анна Иванова",
              avatarUpdatedAt: new Date("2026-08-20T10:00:00.000Z")
            }
          }
        ];
      }
    }
  } as unknown as PrismaService);

  const members = await service.listMembers(WORKSPACE_ID, PROJECT_ID);

  assert.deepEqual(members, [
    {
      userId: USER_ID,
      displayName: "Анна Иванова",
      avatarUpdatedAt: "2026-08-20T10:00:00.000Z"
    }
  ]);
  assert.deepEqual(query, {
    where: {
      workspaceId: WORKSPACE_ID,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      OR: [
        { allProjects: true },
        {
          projectAccesses: {
            some: {
              projectId: PROJECT_ID,
              level: { not: "NONE" }
            }
          }
        }
      ]
    },
    select: {
      userId: true,
      user: {
        select: {
          displayName: true,
          avatarUpdatedAt: true
        }
      }
    },
    orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
    take: 200
  });
});

test("serves an avatar only through the same project-member boundary", async () => {
  let query: unknown;
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const service = new ProjectPresenceService({
    workspaceMember: {
      findFirst: async (candidate: unknown) => {
        query = candidate;
        return {
          user: {
            avatarMimeType: "image/png",
            avatarData: bytes,
            avatarUpdatedAt: new Date("2026-08-20T10:00:00.000Z")
          }
        };
      }
    }
  } as unknown as PrismaService);

  const avatar = await service.getMemberAvatar(
    WORKSPACE_ID,
    PROJECT_ID,
    USER_ID
  );

  assert.equal(avatar.contentType, "image/png");
  assert.deepEqual(avatar.data, Buffer.from(bytes));
  assert.deepEqual(query, {
    where: {
      workspaceId: WORKSPACE_ID,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      OR: [
        { allProjects: true },
        {
          projectAccesses: {
            some: {
              projectId: PROJECT_ID,
              level: { not: "NONE" }
            }
          }
        }
      ],
      userId: USER_ID
    },
    select: {
      user: {
        select: {
          avatarMimeType: true,
          avatarData: true,
          avatarUpdatedAt: true
        }
      }
    }
  });
});

test("does not reveal a missing or inaccessible member avatar", async () => {
  const service = new ProjectPresenceService({
    workspaceMember: { findFirst: async () => null }
  } as unknown as PrismaService);

  await assert.rejects(
    service.getMemberAvatar(WORKSPACE_ID, PROJECT_ID, USER_ID),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND"
  );
});
