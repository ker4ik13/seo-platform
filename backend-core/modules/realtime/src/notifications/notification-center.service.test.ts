import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { NotificationCenterService } from "./notification-center.service.js";

const userId = "01900000-0000-7000-8000-000000000001";
const otherUserId = "01900000-0000-7000-8000-000000000002";
const notificationId = "01900000-0000-7000-8000-000000000010";

test("lists a user-scoped cursor page and unread count", async () => {
  let observedWhere: unknown;
  const service = new NotificationCenterService({
    notification: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return [
          notification(notificationId, "2026-07-29T09:00:00Z"),
          notification(
            "01900000-0000-7000-8000-000000000011",
            "2026-07-29T08:00:00Z"
          )
        ];
      },
      count: async () => 2
    }
  } as unknown as PrismaService);

  const result = await service.list(
    userId,
    { limit: 1, unreadOnly: true },
    "request-1"
  );

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.eventType, "JOB");
  assert.equal(result.page.unreadCount, 2);
  assert.equal(result.page.hasNext, true);
  assert.ok(result.page.nextCursor);
  assert.ok(observedWhere);

  await assert.rejects(
    () =>
      service.list(
        userId,
        {
          limit: 1,
          unreadOnly: false,
          cursor: result.page.nextCursor!
        },
        "request-2"
      ),
    BadRequestException
  );
});

test("mark read never returns another user's notification", async () => {
  const service = new NotificationCenterService({
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>
    ) =>
      callback({
        notification: {
          updateMany: async () => ({ count: 0 }),
          findFirst: async ({
            where
          }: {
            where: { userId: string };
          }) =>
            where.userId === otherUserId
              ? notification(notificationId, "2026-07-29T09:00:00Z")
              : null
        }
      })
  } as unknown as PrismaService);

  await assert.rejects(
    () => service.markRead(userId, notificationId),
    NotFoundException
  );
});

function notification(id: string, createdAt: string) {
  return {
    id,
    workspaceId: "01900000-0000-7000-8000-000000000020",
    projectId: "01900000-0000-7000-8000-000000000021",
    eventType: "JOB",
    severity: "INFO" as const,
    title: "Задание завершено",
    body: "Позиции собраны",
    actorId: null,
    resourceType: "job",
    resourceId: "01900000-0000-7000-8000-000000000022",
    deepLink: "/app/jobs/01900000-0000-7000-8000-000000000022",
    readAt: null,
    createdAt: new Date(createdAt)
  };
}
