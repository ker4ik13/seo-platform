import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import type { WorkspaceInviteListStatus } from "@seo-platform/contracts";
import type { AuthCryptoService } from "../identity/auth-crypto.service.js";

const CURSOR_AAD = Buffer.from("workspace-team-list-cursor:v1", "utf8");
const CURSOR_KEY_CONTEXT = "workspace-team-list-cursor-key:v1";
const CURSOR_VERSION = 1;
const CURSOR_IV_BYTES = 12;
const CURSOR_TAG_BYTES = 16;
const MAX_CURSOR_PAYLOAD_BYTES = 512;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{40,1024}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type WorkspaceTeamCursorContext =
  | {
      readonly scope: "members";
      readonly workspaceId: string;
    }
  | {
      readonly scope: "invites";
      readonly workspaceId: string;
      readonly status: WorkspaceInviteListStatus;
    };

export function sealWorkspaceTeamCursor(
  crypto: AuthCryptoService,
  context: WorkspaceTeamCursorContext,
  lastId: string
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: CURSOR_VERSION,
      ...context,
      lastId
    }),
    "utf8"
  );
  if (
    !UUID_PATTERN.test(context.workspaceId) ||
    !UUID_PATTERN.test(lastId) ||
    payload.length > MAX_CURSOR_PAYLOAD_BYTES
  ) {
    throw new Error("Invalid workspace team cursor payload");
  }

  const initializationVector = randomBytes(CURSOR_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    cursorKey(crypto),
    initializationVector
  );
  cipher.setAAD(CURSOR_AAD);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([
    Buffer.from([CURSOR_VERSION]),
    initializationVector,
    cipher.getAuthTag(),
    encrypted
  ]).toString("base64url");
}

export function openWorkspaceTeamCursor(
  crypto: AuthCryptoService,
  value: string,
  expected: WorkspaceTeamCursorContext
): string {
  try {
    if (!CURSOR_PATTERN.test(value)) throw new Error("invalid encoding");
    const packed = Buffer.from(value, "base64url");
    if (
      packed.toString("base64url") !== value ||
      packed[0] !== CURSOR_VERSION ||
      packed.length <= 1 + CURSOR_IV_BYTES + CURSOR_TAG_BYTES ||
      packed.length >
        1 + CURSOR_IV_BYTES + CURSOR_TAG_BYTES + MAX_CURSOR_PAYLOAD_BYTES
    ) {
      throw new Error("invalid envelope");
    }

    const initializationVector = packed.subarray(1, 1 + CURSOR_IV_BYTES);
    const authenticationTag = packed.subarray(
      1 + CURSOR_IV_BYTES,
      1 + CURSOR_IV_BYTES + CURSOR_TAG_BYTES
    );
    const encrypted = packed.subarray(
      1 + CURSOR_IV_BYTES + CURSOR_TAG_BYTES
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cursorKey(crypto),
      initializationVector
    );
    decipher.setAAD(CURSOR_AAD);
    decipher.setAuthTag(authenticationTag);
    const payload = parsePayload(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
        "utf8"
      )
    );
    if (
      payload.scope !== expected.scope ||
      payload.workspaceId.toLowerCase() !== expected.workspaceId.toLowerCase() ||
      (expected.scope === "invites" && payload.status !== expected.status) ||
      (expected.scope === "members" && payload.status !== undefined)
    ) {
      throw new Error("cursor context mismatch");
    }
    return payload.lastId.toLowerCase();
  } catch {
    throw new Error("Invalid workspace team cursor");
  }
}

function cursorKey(crypto: AuthCryptoService): Buffer {
  const key = crypto.hashOpaqueToken(CURSOR_KEY_CONTEXT);
  if (!/^[a-f0-9]{64}$/u.test(key)) {
    throw new Error("Invalid workspace team cursor key");
  }
  return Buffer.from(key, "hex");
}

function parsePayload(value: string): {
  readonly version: 1;
  readonly scope: "members" | "invites";
  readonly workspaceId: string;
  readonly lastId: string;
  readonly status?: WorkspaceInviteListStatus;
} {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("invalid payload");
  }
  const payload = parsed as Readonly<Record<string, unknown>>;
  const allowedKeys = new Set([
    "version",
    "scope",
    "workspaceId",
    "lastId",
    "status"
  ]);
  if (
    Object.keys(payload).some((key) => !allowedKeys.has(key)) ||
    payload.version !== CURSOR_VERSION ||
    (payload.scope !== "members" && payload.scope !== "invites") ||
    typeof payload.workspaceId !== "string" ||
    !UUID_PATTERN.test(payload.workspaceId) ||
    typeof payload.lastId !== "string" ||
    !UUID_PATTERN.test(payload.lastId) ||
    (payload.status !== undefined &&
      payload.status !== "PENDING" &&
      payload.status !== "ALL") ||
    (payload.scope === "invites" && payload.status === undefined)
  ) {
    throw new Error("invalid payload");
  }
  return payload as ReturnType<typeof parsePayload>;
}
