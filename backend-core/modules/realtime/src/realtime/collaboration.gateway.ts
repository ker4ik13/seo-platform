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
import {
  InvalidRealtimeTicketContractError,
  projectPresenceMaximumConnections,
  projectPresenceUpdateInput,
  projectSemanticChangeInput,
  realtimeCollaborationEvents,
  type PresenceJoinResult,
  type PresenceUpdateResult,
  type ProjectPresenceLeftEvent,
  type ProjectPresenceParticipant,
  type ProjectPresenceParticipantEvent,
  type ProjectPresenceUpdateInput,
  type ProjectSemanticChangeInput,
  type ProjectSemanticChangeResult,
  type RealtimeReadyEvent
} from "@seo-platform/contracts";
import type { Namespace, Socket } from "socket.io";
import {
  type RealtimeAuthorization,
  RealtimeTicketService
} from "../realtime-auth/realtime-ticket.service.js";
import { PresenceStoreService } from "./presence-store.service.js";

const AUTHORIZATION_RECHECK_MILLISECONDS = 15_000;
const PRESENCE_EVENTS_PER_SECOND = 20;
const PRESENCE_EVENT_BURST = 30;

interface RealtimeSocketData {
  authorization?: RealtimeAuthorization;
  authorizationCheckedAt?: number;
  presence?: ProjectPresenceParticipant;
}

interface RateBucket {
  tokens: number;
  updatedAt: number;
}

@WebSocketGateway({
  namespace: "/collaboration",
  transports: ["websocket"]
})
export class CollaborationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly leaseTimers = new Map<string, NodeJS.Timeout>();
  private readonly authorizationChecks = new Map<string, Promise<void>>();
  private readonly rateBuckets = new Map<string, RateBucket>();
  private readonly presenceWrites = new Map<string, Promise<void>>();
  private readonly disconnectedSockets = new Set<string>();
  private namespace?: Namespace;

  public constructor(
    private readonly tickets: RealtimeTicketService,
    private readonly presence: PresenceStoreService
  ) {}

  public afterInit(namespace: Namespace): void {
    this.namespace = namespace;
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
    this.disconnectedSockets.delete(socket.id);
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
        socket.emit(realtimeCollaborationEvents.ready, ready);
      })
      .catch(() => socket.disconnect(true));
  }

  public handleDisconnect(socket: Socket): void {
    this.disconnectedSockets.add(socket.id);
    const timer = this.leaseTimers.get(socket.id);
    if (timer) clearTimeout(timer);
    this.leaseTimers.delete(socket.id);
    this.authorizationChecks.delete(socket.id);
    this.rateBuckets.delete(socket.id);

    const data = socketData(socket);
    const authorization = data.authorization;
    const presence = data.presence;
    if (authorization && presence) {
      const left: ProjectPresenceLeftEvent = {
        connectionId: socket.id,
        userId: authorization.userId,
        occurredAt: new Date().toISOString()
      };
      const room = projectRoom(authorization.projectId);
      const pendingWrite = this.presenceWrites.get(socket.id);
      this.presenceWrites.delete(socket.id);
      void (pendingWrite ?? Promise.resolve())
        .catch(() => undefined)
        .then(() =>
          this.presence.remove(authorization.projectId, socket.id)
        )
        .catch(() => undefined)
        .finally(() => {
          this.namespace
            ?.to(room)
            .emit(realtimeCollaborationEvents.presenceLeft, left);
          this.disconnectedSockets.delete(socket.id);
        });
    } else {
      this.disconnectedSockets.delete(socket.id);
    }
    delete data.presence;

    if (authorization) {
      void this.tickets
        .disconnect(authorization, socket.id)
        .catch(() => undefined);
    }
  }

  @SubscribeMessage(realtimeCollaborationEvents.presenceJoin)
  public async joinPresence(
    @ConnectedSocket() socket: Socket,
    @MessageBody() message: unknown
  ): Promise<PresenceJoinResult> {
    if (!isEmptyMessage(message)) {
      return joinError(
        "VALIDATION_FAILED",
        "Presence join does not accept a client room scope"
      );
    }
    const authorization = socketData(socket).authorization;
    if (!authorization) return unauthenticatedJoin(socket);

    try {
      await this.assertAuthorized(socket, true);
    } catch {
      return unauthenticatedJoin(socket);
    }

    return this.serializedPresenceOperation(socket.id, () =>
      this.performPresenceJoin(socket, authorization)
    );
  }

  private async performPresenceJoin(
    socket: Socket,
    authorization: RealtimeAuthorization
  ): Promise<PresenceJoinResult> {
    const room = projectRoom(authorization.projectId);
    let stored = false;
    try {
      const namespace = this.namespace;
      if (!namespace) throw new Error("Realtime namespace is unavailable");
      await socket.join(room);
      if (this.isSocketDisconnected(socket)) {
        throw new Error("Realtime socket disconnected during presence join");
      }
      const participant =
        socketData(socket).presence ?? initialParticipant(socket, authorization);
      socketData(socket).presence = participant;
      await this.presence.put(authorization.projectId, participant);
      stored = true;
      const participants = await this.presence.list(
        authorization.projectId
      );
      if (participants.length > projectPresenceMaximumConnections) {
        delete socketData(socket).presence;
        await this.presence.remove(authorization.projectId, socket.id);
        await socket.leave(room);
        return joinError(
          "PROVIDER_UNAVAILABLE",
          "Project presence connection limit reached"
        );
      }
      if (this.isSocketDisconnected(socket)) {
        throw new Error("Realtime socket disconnected during presence join");
      }
      const event: ProjectPresenceParticipantEvent = { participant };
      socket.to(room).emit(realtimeCollaborationEvents.presenceJoined, event);
      return {
        ok: true,
        data: {
          connectionId: socket.id,
          projectId: authorization.projectId,
          authorizationExpiresAt:
            authorization.authorizationExpiresAt.toISOString(),
          participant,
          participants
        }
      };
    } catch {
      delete socketData(socket).presence;
      await Promise.resolve(socket.leave(room)).catch(() => undefined);
      if (stored) {
        await this.presence
          .remove(authorization.projectId, socket.id)
          .catch(() => undefined);
      }
      return joinError(
        "PROVIDER_UNAVAILABLE",
        "Project presence is temporarily unavailable"
      );
    }
  }

  @SubscribeMessage(realtimeCollaborationEvents.presenceUpdate)
  public async updatePresence(
    @ConnectedSocket() socket: Socket,
    @MessageBody() message: unknown
  ): Promise<PresenceUpdateResult> {
    let input: ProjectPresenceUpdateInput;
    try {
      input = projectPresenceUpdateInput(message);
    } catch (error) {
      if (!(error instanceof InvalidRealtimeTicketContractError)) throw error;
      return updateError(
        "VALIDATION_FAILED",
        "Presence update payload is invalid"
      );
    }
    const data = socketData(socket);
    const authorization = data.authorization;
    const current = data.presence;
    if (!authorization || !current) return unauthenticatedUpdate(socket);
    if (!this.consumeRateToken(socket.id)) {
      return updateError(
        "RATE_LIMITED",
        "Presence updates are arriving too quickly"
      );
    }

    try {
      await this.assertAuthorized(socket, false);
    } catch {
      return unauthenticatedUpdate(socket);
    }
    try {
      return await this.serializedPresenceOperation(socket.id, () =>
        this.persistPresenceUpdate(socket, authorization, input)
      );
    } catch {
      socket.disconnect(true);
      return updateError(
        "PROVIDER_UNAVAILABLE",
        "Project presence is temporarily unavailable"
      );
    }
  }

  @SubscribeMessage(realtimeCollaborationEvents.semanticChange)
  public async publishSemanticChange(
    @ConnectedSocket() socket: Socket,
    @MessageBody() message: unknown
  ): Promise<ProjectSemanticChangeResult> {
    let input: ProjectSemanticChangeInput;
    try {
      input = projectSemanticChangeInput(message);
    } catch (error) {
      if (!(error instanceof InvalidRealtimeTicketContractError)) throw error;
      return semanticChangeError(
        "VALIDATION_FAILED",
        "Semantic change payload is invalid"
      );
    }
    const data = socketData(socket);
    const authorization = data.authorization;
    if (!authorization || !data.presence) {
      return unauthenticatedSemanticChange(socket);
    }
    if (!this.consumeRateToken(socket.id)) {
      return semanticChangeError(
        "RATE_LIMITED",
        "Semantic change signals are arriving too quickly"
      );
    }
    try {
      await this.assertAuthorized(socket, false);
    } catch {
      return unauthenticatedSemanticChange(socket);
    }
    const event = {
      ...input,
      projectId: authorization.projectId,
      actorUserId: authorization.userId,
      occurredAt: new Date().toISOString()
    };
    socket
      .to(projectRoom(authorization.projectId))
      .emit(realtimeCollaborationEvents.semanticChanged, event);
    return { ok: true, data: event };
  }

  private async serializedPresenceOperation<Result>(
    socketId: string,
    execute: () => Promise<Result>
  ): Promise<Result> {
    const previous = this.presenceWrites.get(socketId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(execute);
    const tail = operation.then(
      () => undefined,
      () => undefined
    );
    this.presenceWrites.set(socketId, tail);
    try {
      return await operation;
    } finally {
      if (this.presenceWrites.get(socketId) === tail) {
        this.presenceWrites.delete(socketId);
      }
    }
  }

  private async persistPresenceUpdate(
    socket: Socket,
    authorization: RealtimeAuthorization,
    input: ProjectPresenceUpdateInput
  ): Promise<PresenceUpdateResult> {
    const data = socketData(socket);
    const current = data.presence;
    if (!current || this.isSocketDisconnected(socket)) {
      return unauthenticatedUpdate(socket);
    }
    if (input.sequence <= current.sequence) {
      return { ok: true, data: current };
    }
    if (authorization.authorizationExpiresAt.getTime() <= Date.now()) {
      return unauthenticatedUpdate(socket);
    }
    const participant: ProjectPresenceParticipant = {
      connectionId: current.connectionId,
      userId: current.userId,
      clientInstanceId: current.clientInstanceId,
      route: input.route,
      status: input.status,
      cursor: roundedCursor(input.cursor),
      selection: input.selection,
      view: input.view,
      activity: input.activity,
      editing: input.editing,
      sequence: input.sequence,
      updatedAt: new Date().toISOString()
    };
    await this.presence.put(authorization.projectId, participant);
    if (this.isSocketDisconnected(socket)) {
      return unauthenticatedUpdate(socket);
    }
    data.presence = participant;
    const event: ProjectPresenceParticipantEvent = { participant };
    socket
      .to(projectRoom(authorization.projectId))
      .emit(realtimeCollaborationEvents.presenceUpdated, event);
    return { ok: true, data: participant };
  }

  private async assertAuthorized(
    socket: Socket,
    force: boolean
  ): Promise<void> {
    const data = socketData(socket);
    const authorization = data.authorization;
    if (
      !authorization ||
      authorization.authorizationExpiresAt.getTime() <= Date.now()
    ) {
      throw new Error("Realtime authorization expired");
    }
    if (
      !force &&
      data.authorizationCheckedAt !== undefined &&
      Date.now() - data.authorizationCheckedAt <
        AUTHORIZATION_RECHECK_MILLISECONDS
    ) {
      return;
    }
    const existing = this.authorizationChecks.get(socket.id);
    if (existing) return existing;
    const check = this.tickets
      .assertActive(authorization, socket.id)
      .then(() => {
        data.authorizationCheckedAt = Date.now();
      })
      .finally(() => {
        this.authorizationChecks.delete(socket.id);
      });
    this.authorizationChecks.set(socket.id, check);
    return check;
  }

  private consumeRateToken(socketId: string): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(socketId) ?? {
      tokens: PRESENCE_EVENT_BURST,
      updatedAt: now
    };
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1_000;
    bucket.tokens = Math.min(
      PRESENCE_EVENT_BURST,
      bucket.tokens + elapsedSeconds * PRESENCE_EVENTS_PER_SECOND
    );
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      this.rateBuckets.set(socketId, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.rateBuckets.set(socketId, bucket);
    return true;
  }

  private isSocketDisconnected(socket: Socket): boolean {
    return socket.disconnected || this.disconnectedSockets.has(socket.id);
  }
}

function initialParticipant(
  socket: Socket,
  authorization: RealtimeAuthorization
): ProjectPresenceParticipant {
  return {
    connectionId: socket.id,
    userId: authorization.userId,
    clientInstanceId: authorization.clientInstanceId,
    route: "/app",
    // A fresh socket has not reported browser activity yet. Starting it as
    // ACTIVE would briefly resurrect an idle user on every authorization
    // lease renewal, before the first client presence update arrives.
    status: "AWAY",
    cursor: null,
    selection: null,
    view: null,
    activity: null,
    editing: false,
    sequence: 0,
    updatedAt: new Date().toISOString()
  };
}

function roundedCursor(
  cursor: ProjectPresenceUpdateInput["cursor"]
): ProjectPresenceUpdateInput["cursor"] {
  if (!cursor) return null;
  return {
    x: roundCoordinate(cursor.x),
    y: roundCoordinate(cursor.y),
    targetKey: cursor.targetKey,
    targetX:
      cursor.targetX === null ? null : roundCoordinate(cursor.targetX),
    targetY:
      cursor.targetY === null ? null : roundCoordinate(cursor.targetY)
  };
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
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

function joinError(
  code: "VALIDATION_FAILED" | "PROVIDER_UNAVAILABLE",
  message: string
): PresenceJoinResult {
  return { ok: false, error: { code, message } };
}

function updateError(
  code:
    | "VALIDATION_FAILED"
    | "RATE_LIMITED"
    | "PROVIDER_UNAVAILABLE",
  message: string
): PresenceUpdateResult {
  return { ok: false, error: { code, message } };
}

function unauthenticatedJoin(socket: Socket): PresenceJoinResult {
  socket.disconnect(true);
  return {
    ok: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "Realtime authorization is no longer active"
    }
  };
}

function unauthenticatedUpdate(socket: Socket): PresenceUpdateResult {
  socket.disconnect(true);
  return {
    ok: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "Realtime authorization is no longer active"
    }
  };
}

function semanticChangeError(
  code: "VALIDATION_FAILED" | "RATE_LIMITED",
  message: string
): ProjectSemanticChangeResult {
  return { ok: false, error: { code, message } };
}

function unauthenticatedSemanticChange(
  socket: Socket
): ProjectSemanticChangeResult {
  socket.disconnect(true);
  return {
    ok: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "Realtime authorization is no longer active"
    }
  };
}
