import { Buffer } from "node:buffer";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import {
  notificationEventTypes,
  type NotificationCollectionResponse,
  type NotificationEventType,
  type NotificationListItem,
  type NotificationListQuery,
  type NotificationReadAllResult
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface NotificationCursor {
  readonly version: 1;
  readonly createdAt: string;
  readonly id: string;
  readonly unreadOnly: boolean;
}

interface StoredNotification {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly eventType: string;
  readonly severity: NotificationListItem["severity"];
  readonly title: string;
  readonly body: string | null;
  readonly actorId: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly deepLink: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

@Injectable()
export class NotificationCenterService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    userId: string,
    query: NotificationListQuery,
    requestId: string
  ): Promise<NotificationCollectionResponse> {
    const cursor = query.cursor
      ? decodeCursor(query.cursor, query.unreadOnly)
      : undefined;
    const baseWhere: Prisma.NotificationWhereInput = {
      userId,
      inAppVisible: true,
      ...(query.unreadOnly ? { readAt: null } : {})
    };
    const where: Prisma.NotificationWhereInput = {
      ...baseWhere,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              {
                createdAt: new Date(cursor.createdAt),
                id: { lt: cursor.id }
              }
            ]
          }
        : {})
    };
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: notificationSelect
      }),
      this.prisma.notification.count({
        where: { userId, inAppVisible: true, readAt: null }
      })
    ]);
    const hasNext = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      data: pageRows.map(notificationItem),
      page: {
        hasNext,
        unreadCount,
        ...(hasNext && last
          ? {
              nextCursor: encodeCursor({
                version: 1,
                createdAt: last.createdAt.toISOString(),
                id: last.id,
                unreadOnly: query.unreadOnly
              })
            }
          : {})
      },
      meta: { requestId }
    };
  }

  public async markRead(
    userId: string,
    notificationId: string
  ): Promise<NotificationListItem> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.notification.updateMany({
        where: {
          id: notificationId,
          userId,
          inAppVisible: true,
          readAt: null
        },
        data: { readAt: new Date() }
      });
      const notification = await transaction.notification.findFirst({
        where: { id: notificationId, userId, inAppVisible: true },
        select: notificationSelect
      });
      if (!notification) throw new NotFoundException("Notification not found");
      return notificationItem(notification);
    });
  }

  public async markAllRead(
    userId: string
  ): Promise<NotificationReadAllResult> {
    const readAt = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { userId, inAppVisible: true, readAt: null },
      data: { readAt }
    });
    return {
      updated: result.count,
      readAt: readAt.toISOString()
    };
  }
}

const notificationSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  eventType: true,
  severity: true,
  title: true,
  body: true,
  actorId: true,
  resourceType: true,
  resourceId: true,
  deepLink: true,
  readAt: true,
  createdAt: true
} as const;

function notificationItem(
  notification: StoredNotification
): NotificationListItem {
  return {
    id: notification.id,
    workspaceId: notification.workspaceId,
    ...(notification.projectId
      ? { projectId: notification.projectId }
      : {}),
    eventType: storedEventType(notification.eventType),
    severity: notification.severity,
    title: notification.title,
    ...(notification.body ? { body: notification.body } : {}),
    ...(notification.actorId ? { actorId: notification.actorId } : {}),
    ...(notification.resourceType && notification.resourceId
      ? {
          resource: {
            type: notification.resourceType,
            id: notification.resourceId
          }
        }
      : {}),
    ...(notification.deepLink ? { deepLink: notification.deepLink } : {}),
    ...(notification.readAt
      ? { readAt: notification.readAt.toISOString() }
      : {}),
    createdAt: notification.createdAt.toISOString()
  };
}

function storedEventType(value: string): NotificationEventType {
  const eventType = notificationEventTypes.find(
    (candidate) => candidate === value
  );
  if (!eventType) {
    throw new InternalServerErrorException(
      "Stored notification event type is invalid"
    );
  }
  return eventType;
}

function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  unreadOnly: boolean
): NotificationCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw invalidCursor();
  }
  const cursor = parsed as Readonly<Record<string, unknown>>;
  const createdAt =
    typeof cursor.createdAt === "string"
      ? new Date(cursor.createdAt)
      : new Date(Number.NaN);
  if (
    cursor.version !== 1 ||
    typeof cursor.id !== "string" ||
    !UUID_PATTERN.test(cursor.id) ||
    cursor.unreadOnly !== unreadOnly ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw invalidCursor();
  }
  return {
    version: 1,
    createdAt: createdAt.toISOString(),
    id: cursor.id,
    unreadOnly
  };
}

function invalidCursor(): BadRequestException {
  return new BadRequestException(
    "Notification cursor is invalid for the current query"
  );
}
