import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { AuthCryptoService } from "../identity/auth-crypto.service.js";
import {
  openWorkspaceTeamCursor,
  sealWorkspaceTeamCursor
} from "./team-cursor.js";

const WORKSPACE_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "01900000-0000-7000-8000-000000000002";
const LAST_ID = "01900000-0000-7000-8000-000000000010";
const crypto = new AuthCryptoService(
  loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    AUTH_PASSWORD_PEPPER: "test-only-team-cursor-pepper"
  })
);

test("seals an opaque team cursor and binds it to workspace and list filter", () => {
  const context = {
    scope: "invites",
    workspaceId: WORKSPACE_ID,
    status: "PENDING"
  } as const;
  const first = sealWorkspaceTeamCursor(crypto, context, LAST_ID);
  const second = sealWorkspaceTeamCursor(crypto, context, LAST_ID);

  assert.match(first, /^[A-Za-z0-9_-]{40,1024}$/u);
  assert.notEqual(first, second);
  assert.equal(first.includes(WORKSPACE_ID), false);
  assert.equal(first.includes(LAST_ID), false);
  assert.equal(openWorkspaceTeamCursor(crypto, first, context), LAST_ID);
  assert.throws(
    () =>
      openWorkspaceTeamCursor(crypto, first, {
        ...context,
        workspaceId: OTHER_WORKSPACE_ID
      }),
    { message: "Invalid workspace team cursor" }
  );
  assert.throws(
    () =>
      openWorkspaceTeamCursor(crypto, first, {
        ...context,
        status: "ALL"
      }),
    { message: "Invalid workspace team cursor" }
  );
});

test("rejects a tampered team cursor", () => {
  const cursor = sealWorkspaceTeamCursor(
    crypto,
    { scope: "members", workspaceId: WORKSPACE_ID },
    LAST_ID
  );
  const tampered = Buffer.from(cursor, "base64url");
  tampered[tampered.length - 1] = tampered.at(-1)! ^ 1;

  assert.throws(
    () =>
      openWorkspaceTeamCursor(
        crypto,
        tampered.toString("base64url"),
        { scope: "members", workspaceId: WORKSPACE_ID }
      ),
    { message: "Invalid workspace team cursor" }
  );
});
