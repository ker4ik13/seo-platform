import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Namespace, Socket } from "socket.io";
import {
  type RealtimeAuthorization,
  RealtimeTicketService
} from "../realtime-auth/realtime-ticket.service.js";
import { CollaborationGateway } from "./collaboration.gateway.js";

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
    })
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
    })
  );
  const socket = socketDouble({
    data: { authorization }
  });

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
  assert.equal(
    "projectId" in readyPayload,
    false
  );

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
    })
  );
  const socket = socketDouble({
    data: { authorization }
  });

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
});

test("disconnects a socket whose bounded authorization is no longer active", async () => {
  const gateway = new CollaborationGateway(
    ticketService({
      assertActive: async () => {
        throw new Error("revoked");
      }
    })
  );
  const socket = socketDouble({
    data: { authorization: activeAuthorization() }
  });

  const result = await gateway.joinPresence(socket.socket, {});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNAUTHENTICATED");
  assert.equal(socket.disconnectCount, 1);
  assert.deepEqual(socket.joined, []);
});

interface TicketServiceOverrides {
  readonly consume?: (...args: unknown[]) => Promise<RealtimeAuthorization>;
  readonly assertActive?: (...args: unknown[]) => Promise<void>;
  readonly disconnect?: (...args: unknown[]) => Promise<void>;
}

function ticketService(
  overrides: TicketServiceOverrides
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

interface SocketDoubleOptions {
  readonly auth?: Readonly<Record<string, unknown>>;
  readonly origin?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>>;
}

function socketDouble(options: SocketDoubleOptions = {}) {
  const joined: string[] = [];
  const emitted: Array<{ event: string; payload: unknown }> = [];
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
    emitted,
    get disconnectCount() {
      return disconnectCount;
    }
  };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
