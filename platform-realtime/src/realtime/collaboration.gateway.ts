import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway
} from "@nestjs/websockets";
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit
} from "@nestjs/websockets";
import type {
  PresenceJoinResult,
  RealtimeReadyEvent
} from "@seo-platform/contracts";
import type { Namespace, Socket } from "socket.io";
import {
  type RealtimeAuthorization,
  RealtimeTicketService
} from "../realtime-auth/realtime-ticket.service.js";

interface RealtimeSocketData {
  authorization?: RealtimeAuthorization;
}

@WebSocketGateway({
  namespace: "/collaboration",
  transports: ["websocket"]
})
export class CollaborationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly leaseTimers = new Map<string, NodeJS.Timeout>();

  public constructor(private readonly tickets: RealtimeTicketService) {}

  public afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      void this.authorizeHandshake(socket, next);
    });
  }

  private async authorizeHandshake(
    socket: Socket,
    next: (error?: Error) => void
  ): Promise<void> {
    const ticket = handshakeTicket(socket);
    const origin = handshakeOrigin(socket);
    if (!ticket || !origin) {
      next(authenticationError());
      return;
    }
    try {
      socketData(socket).authorization = await this.tickets.consume(
        ticket,
        origin,
        socket.id
      );
      next();
    } catch {
      next(authenticationError());
    }
  }

  public handleConnection(socket: Socket): void {
    const authorization = socketData(socket).authorization;
    if (!authorization) {
      socket.disconnect(true);
      return;
    }
    const remainingLease =
      authorization.authorizationExpiresAt.getTime() - Date.now();
    if (remainingLease <= 0) {
      socket.disconnect(true);
      return;
    }

    const timer = setTimeout(() => {
      socket.disconnect(true);
    }, remainingLease);
    timer.unref();
    this.leaseTimers.set(socket.id, timer);

    void Promise.resolve(socket.join(userRoom(authorization.userId)))
      .then(() => {
        const ready: RealtimeReadyEvent = {
          connectionId: socket.id,
          userId: authorization.userId,
          sessionId: authorization.sessionId,
          clientInstanceId: authorization.clientInstanceId,
          authorizationExpiresAt:
            authorization.authorizationExpiresAt.toISOString()
        };
        socket.emit("realtime.ready", ready);
      })
      .catch(() => socket.disconnect(true));
  }

  public handleDisconnect(socket: Socket): void {
    const timer = this.leaseTimers.get(socket.id);
    if (timer) clearTimeout(timer);
    this.leaseTimers.delete(socket.id);

    const authorization = socketData(socket).authorization;
    if (authorization) {
      void this.tickets
        .disconnect(authorization, socket.id)
        .catch(() => undefined);
    }
  }

  @SubscribeMessage("presence.join")
  public async joinPresence(
    @ConnectedSocket() socket: Socket,
    @MessageBody() message: unknown
  ): Promise<PresenceJoinResult> {
    if (!isEmptyMessage(message)) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Presence join does not accept a client room scope"
        }
      };
    }
    const authorization = socketData(socket).authorization;
    if (!authorization) return unauthenticated(socket);

    try {
      await this.tickets.assertActive(authorization, socket.id);
      await socket.join(projectRoom(authorization.projectId));
      return {
        ok: true,
        data: {
          connectionId: socket.id,
          projectId: authorization.projectId,
          authorizationExpiresAt:
            authorization.authorizationExpiresAt.toISOString()
        }
      };
    } catch {
      return unauthenticated(socket);
    }
  }
}

function socketData(socket: Socket): RealtimeSocketData {
  return socket.data as RealtimeSocketData;
}

function handshakeTicket(socket: Socket): unknown {
  const auth = socket.handshake.auth;
  if (
    typeof auth !== "object" ||
    auth === null ||
    Array.isArray(auth) ||
    Object.getPrototypeOf(auth) !== Object.prototype ||
    Object.keys(auth).length !== 1 ||
    !("ticket" in auth)
  ) {
    return undefined;
  }
  return (auth as Readonly<Record<string, unknown>>).ticket;
}

function handshakeOrigin(socket: Socket): string | undefined {
  const origin = socket.handshake.headers.origin;
  return typeof origin === "string" ? origin : undefined;
}

function isEmptyMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0
  );
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}

function authenticationError(): Error {
  return new Error("Realtime authentication failed");
}

function unauthenticated(socket: Socket): PresenceJoinResult {
  socket.disconnect(true);
  return {
    ok: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "Realtime authorization is no longer active"
    }
  };
}
