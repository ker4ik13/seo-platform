import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type {
  ProjectPresenceParticipant,
  ProjectPresenceUpdateInput,
  PresenceJoinResult
} from "@seo-platform/contracts";
import type { Namespace, Socket } from "socket.io";
import {
  type RealtimeAuthorization,
  RealtimeTicketService
} from "../realtime-auth/realtime-ticket.service.js";
import { CollaborationGateway } from "./collaboration.gateway.js";
import type { PresenceStoreService } from "./presence-store.service.js";

const ORIGIN = "https://app.example.test";
const TICKET = randomBytes(32).toString("base64url");

test("handshake consumes only an exact ticket object with an Origin", async () => {
  const authorization = activeAuthorization();
  const consumed: unknown[][] = [];
  const gateway = new CollaborationGateway(
    ticketService({
      consume: async (...args: unknown[]) => {
        consumed.push(args);
        return authorization;
      }
    }),
    presenceStore()
  );
  const middleware = captureMiddleware(gateway);
  const accepted = socketDouble({ auth: { ticket: TICKET } });

  assert.equal(await runMiddleware(middleware, accepted.socket), undefined);
  assert.deepEqual(consumed, [[TICKET, ORIGIN, accepted.socket.id]]);
  assert.equal(
    (
      accepted.socket.data as {
        authorization?: RealtimeAuthorization;
      }
    ).authorization,
    authorization
  );

  const extraField = socketDouble({
    auth: { ticket: TICKET, projectId: authorization.projectId }
  });
  assert.match(
    (await runMiddleware(middleware, extraField.socket))?.message ?? "",
    /authentication failed/iu
  );
  const missingOrigin = socketDouble({
    auth: { ticket: TICKET },
    origin: undefined
  });
  assert.match(
    (await runMiddleware(middleware, missingOrigin.socket))?.message ?? "",
    /authentication failed/iu
  );
  assert.equal(consumed.length, 1);
});

test("joins only the server-derived user room and emits a safe ready event", async () => {
  const authorization = activeAuthorization();
  const disconnected: unknown[][] = [];
  const gateway = new CollaborationGateway(
    ticketService({
      disconnect: async (...args: unknown[]) => {
        disconnected.push(args);
      }
    }),
    presenceStore()
  );
  const socket = socketDouble({ data: { authorization } });

  gateway.handleConnection(socket.socket);
  await nextTurn();

  assert.deepEqual(socket.joined, [`user:${authorization.userId}`]);
  assert.equal(socket.emitted.length, 1);
  assert.equal(socket.emitted[0]?.event, "realtime.ready");
  assert.deepEqual(socket.emitted[0]?.payload, {
    connectionId: socket.socket.id,
    userId: authorization.userId,
    sessionId: authorization.sessionId,
    clientInstanceId: authorization.clientInstanceId,
    authorizationExpiresAt:
      authorization.authorizationExpiresAt.toISOString()
  });
  const readyPayload = socket.emitted[0]?.payload;
  assert.ok(
    typeof readyPayload === "object" &&
      readyPayload !== null &&
      !Array.isArray(readyPayload)
  );
  assert.equal("projectId" in readyPayload, false);

  gateway.handleDisconnect(socket.socket);
  await nextTurn();
  assert.deepEqual(disconnected, [[authorization, socket.socket.id]]);
});

test("rejects client room scope and joins only the authorized project", async () => {
  const authorization = activeAuthorization();
  const asserted: unknown[][] = [];
  const gateway = new CollaborationGateway(
    ticketService({
      assertActive: async (...args: unknown[]) => {
        asserted.push(args);
      }
    }),
    presenceStore()
  );
  const socket = socketDouble({ data: { authorization } });
  const namespace = namespaceDouble([socket.socket]);
  gateway.afterInit(namespace.namespace);

  const malicious = await gateway.joinPresence(socket.socket, {
    projectId: "0198f258-8cc7-7abc-8def-1234567890ff",
    room: "project:attacker-controlled"
  });
  assert.deepEqual(malicious, {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: "Presence join does not accept a client room scope"
    }
  });
  assert.equal(asserted.length, 0);
  assert.deepEqual(socket.joined, []);

  const joined = await gateway.joinPresence(socket.socket, {});
  assert.equal(joined.ok, true);
  assert.deepEqual(asserted, [[authorization, socket.socket.id]]);
  assert.deepEqual(socket.joined, [
    `project:${authorization.projectId}`
  ]);
  const joinedData = successfulJoin(joined);
  assert.equal(joinedData.participant.userId, authorization.userId);
  assert.equal(
    joinedData.participant.status,
    "AWAY",
    "a new socket must stay hidden until the browser confirms activity"
  );
  assert.equal(joinedData.participants.length, 1);
  assert.deepEqual(socket.broadcasts[0], {
    room: `project:${authorization.projectId}`,
    event: "presence.joined",
    payload: { participant: joinedData.participant }
  });
});

test("broadcasts bounded cursor and semantic selection metadata", async () => {
  const authorization = activeAuthorization();
  const gateway = new CollaborationGateway(ticketService(), presenceStore());
  const socket = socketDouble({ data: { authorization } });
  const namespace = namespaceDouble([socket.socket]);
  gateway.afterInit(namespace.namespace);
  await gateway.joinPresence(socket.socket, {});
  socket.broadcasts.length = 0;

  const result = await gateway.updatePresence(socket.socket, updateInput());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.cursor?.x, 0.1235);
  assert.equal(result.data.cursor?.targetX, 0.3333);
  assert.deepEqual(result.data.selection, {
    entity: "KEYWORD",
    selectedIds: ["0198f258-8cc7-7abc-8def-1234567890c1"],
    highlightedIds: ["0198f258-8cc7-7abc-8def-1234567890c2"],
    columnId: "query"
  });
  assert.deepEqual(socket.broadcasts, [
    {
      room: `project:${authorization.projectId}`,
      event: "presence.updated",
      payload: { participant: result.data }
    }
  ]);
  assert.equal(JSON.stringify(result).includes("keyword text"), false);
});

test("rejects malformed cursor anchors without changing presence", async () => {
  const authorization = activeAuthorization();
  const gateway = new CollaborationGateway(ticketService(), presenceStore());
  const socket = socketDouble({ data: { authorization } });
  gateway.afterInit(namespaceDouble([socket.socket]).namespace);
  const joined = successfulJoin(
    await gateway.joinPresence(socket.socket, {})
  );
  socket.broadcasts.length = 0;

  const result = await gateway.updatePresence(socket.socket, {
    ...updateInput(),
    cursor: {
      ...updateInput().cursor,
      targetKey: "keyword text from the cell"
    }
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: "Presence update payload is invalid"
    }
  });
  assert.deepEqual(socket.broadcasts, []);
  assert.deepEqual(
    (socket.socket.data as { presence?: unknown }).presence,
    joined.participant
  );
});

test("disconnects a socket whose bounded authorization is no longer active", async () => {
  const gateway = new CollaborationGateway(
    ticketService({
      assertActive: async () => {
        throw new Error("revoked");
      }
    }),
    presenceStore()
  );
  const socket = socketDouble({ data: { authorization: activeAuthorization() } });
  gateway.afterInit(namespaceDouble([socket.socket]).namespace);

  const result = await gateway.joinPresence(socket.socket, {});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAUTHENTICATED");
  assert.equal(socket.disconnectCount, 1);
  assert.deepEqual(socket.joined, []);
});

test("announces a safe leave event and clears local presence state", async () => {
  const authorization = activeAuthorization();
  const gateway = new CollaborationGateway(ticketService(), presenceStore());
  const socket = socketDouble({ data: { authorization } });
  const namespace = namespaceDouble([socket.socket]);
  gateway.afterInit(namespace.namespace);
  await gateway.joinPresence(socket.socket, {});

  gateway.handleDisconnect(socket.socket);
  await nextTurn();

  assert.equal(namespace.broadcasts.length, 1);
  assert.deepEqual(namespace.broadcasts[0], {
    room: `project:${authorization.projectId}`,
    event: "presence.left",
    payload: {
      connectionId: socket.socket.id,
      userId: authorization.userId,
      occurredAt: namespace.broadcasts[0]?.payload.occurredAt
    }
  });
  assert.equal(
    (socket.socket.data as { presence?: unknown }).presence,
    undefined
  );
});

test("never broadcasts a presence update after the socket has left", async () => {
  const authorization = activeAuthorization();
  const baseStore = presenceStore();
  const put = baseStore.put.bind(baseStore);
  let putCalls = 0;
  let releaseWrite: (() => void) | undefined;
  const blockedWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const store = {
    put: async (...args: Parameters<PresenceStoreService["put"]>) => {
      putCalls += 1;
      if (putCalls > 1) await blockedWrite;
      await put(...args);
    },
    list: baseStore.list.bind(baseStore),
    remove: baseStore.remove.bind(baseStore)
  } as PresenceStoreService;
  const gateway = new CollaborationGateway(ticketService(), store);
  const socket = socketDouble({ data: { authorization } });
  const namespace = namespaceDouble([socket.socket]);
  gateway.afterInit(namespace.namespace);
  await gateway.joinPresence(socket.socket, {});
  socket.broadcasts.length = 0;

  const update = gateway.updatePresence(socket.socket, updateInput());
  await nextTurn();
  gateway.handleDisconnect(socket.socket);
  releaseWrite?.();

  const result = await update;
  await nextTurn();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAUTHENTICATED");
  assert.deepEqual(socket.broadcasts, []);
  assert.equal(namespace.broadcasts.length, 1);
  assert.equal(namespace.broadcasts[0]?.event, "presence.left");
});

interface TicketServiceOverrides {
  readonly consume?: (...args: unknown[]) => Promise<RealtimeAuthorization>;
  readonly assertActive?: (...args: unknown[]) => Promise<void>;
  readonly disconnect?: (...args: unknown[]) => Promise<void>;
}

function ticketService(
  overrides: TicketServiceOverrides = {}
): RealtimeTicketService {
  return {
    consume:
      overrides.consume ??
      (async () => {
        throw new Error("unexpected consume");
      }),
    assertActive: overrides.assertActive ?? (async () => undefined),
    disconnect: overrides.disconnect ?? (async () => undefined)
  } as unknown as RealtimeTicketService;
}

function presenceStore(): PresenceStoreService {
  const participants = new Map<string, ProjectPresenceParticipant>();
  return {
    put: async (
      _projectId: string,
      participant: ProjectPresenceParticipant
    ) => {
      participants.set(participant.connectionId, participant);
    },
    list: async () => [...participants.values()],
    remove: async (_projectId: string, connectionId: string) => {
      participants.delete(connectionId);
    }
  } as unknown as PresenceStoreService;
}

type Middleware = (
  socket: Socket,
  next: (error?: Error) => void
) => void;

function captureMiddleware(gateway: CollaborationGateway): Middleware {
  let middleware: Middleware | undefined;
  const namespace = {
    use: (candidate: Middleware) => {
      middleware = candidate;
    }
  } as unknown as Namespace;
  gateway.afterInit(namespace);
  assert.ok(middleware);
  return middleware;
}

function runMiddleware(
  middleware: Middleware,
  socket: Socket
): Promise<Error | undefined> {
  return new Promise((resolve) => middleware(socket, resolve));
}

function activeAuthorization(): RealtimeAuthorization {
  return {
    ticketId: "0198f258-8cc7-7abc-8def-1234567890b2",
    userId: "0198f258-8cc7-7abc-8def-1234567890ab",
    sessionId: "0198f258-8cc7-7abc-8def-1234567890ac",
    sessionFamilyId: "0198f258-8cc7-7abc-8def-1234567890ad",
    workspaceId: "0198f258-8cc7-7abc-8def-1234567890ae",
    projectId: "0198f258-8cc7-7abc-8def-1234567890af",
    membershipId: "0198f258-8cc7-7abc-8def-1234567890b0",
    membershipVersion: 4,
    clientInstanceId: "0198f258-8cc7-7abc-8def-1234567890b1",
    authorizationExpiresAt: new Date(Date.now() + 60_000)
  };
}

function updateInput(): ProjectPresenceUpdateInput {
  return {
    route: "/app/semantics",
    status: "ACTIVE",
    cursor: {
      x: 0.123456,
      y: 0.765432,
      targetKey: "keyword:0198f258-8cc7-7abc-8def-1234567890c1",
      targetX: 0.333333,
      targetY: 0.666666
    },
    selection: {
      entity: "KEYWORD",
      selectedIds: ["0198f258-8cc7-7abc-8def-1234567890c1"],
      highlightedIds: ["0198f258-8cc7-7abc-8def-1234567890c2"],
      columnId: "query"
    },
    view: {
      kind: "SEMANTIC_CORE",
      groupIds: ["0198f258-8cc7-7abc-8def-1234567890c3"]
    },
    activity: "SEMANTIC_POSITIONS",
    editing: false,
    sequence: 1
  };
}

interface SocketDoubleOptions {
  readonly auth?: Readonly<Record<string, unknown>>;
  readonly origin?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>>;
}

function socketDouble(options: SocketDoubleOptions = {}) {
  const joined: string[] = [];
  const left: string[] = [];
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const broadcasts: Array<{
    room: string;
    event: string;
    payload: unknown;
  }> = [];
  let disconnectCount = 0;
  const socket = {
    id: "socket_connection_01",
    data: { ...options.data },
    handshake: {
      auth: options.auth ?? {},
      headers:
        options.origin === undefined && "origin" in options
          ? {}
          : { origin: options.origin ?? ORIGIN }
    },
    join: async (room: string) => {
      joined.push(room);
    },
    leave: async (room: string) => {
      left.push(room);
    },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        broadcasts.push({ room, event, payload });
      }
    }),
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return true;
    },
    disconnect: () => {
      disconnectCount += 1;
      return socket;
    }
  } as unknown as Socket;
  return {
    socket,
    joined,
    left,
    emitted,
    broadcasts,
    get disconnectCount() {
      return disconnectCount;
    }
  };
}

function namespaceDouble(sockets: readonly Socket[]) {
  let middleware: Middleware | undefined;
  const broadcasts: Array<{
    room: string;
    event: string;
    payload: Record<string, unknown>;
  }> = [];
  const namespace = {
    use: (candidate: Middleware) => {
      middleware = candidate;
    },
    in: () => ({ fetchSockets: async () => sockets }),
    to: (room: string) => ({
      emit: (event: string, payload: Record<string, unknown>) => {
        broadcasts.push({ room, event, payload });
      }
    })
  } as unknown as Namespace;
  return { namespace, broadcasts, get middleware() { return middleware; } };
}

function successfulJoin(
  result: PresenceJoinResult
): Extract<PresenceJoinResult, { ok: true }>["data"] {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Presence join failed");
  return result.data;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
