import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { AuthCryptoService } from "./auth-crypto.service.js";

const cryptoService = new AuthCryptoService(
  loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    AUTH_PASSWORD_PEPPER: "test-only-pepper"
  })
);

test("hashes and verifies a password with Argon2id", async () => {
  const hash = await cryptoService.hashPassword(
    "correct horse battery staple"
  );

  assert.match(hash, /^\$argon2id\$/u);
  assert.equal(
    await cryptoService.verifyPassword(
      "correct horse battery staple",
      hash
    ),
    true
  );
  assert.equal(await cryptoService.verifyPassword("wrong password", hash), false);
});
test("creates opaque random tokens and stable non-reversible lookup hashes", () => {
  const first = cryptoService.randomToken();
  const second = cryptoService.randomToken();

  assert.notEqual(first, second);
  assert.equal(cryptoService.hashOpaqueToken(first).length, 64);
  assert.equal(
    cryptoService.hashOpaqueToken(first),
    cryptoService.hashOpaqueToken(first)
  );
  assert.notEqual(cryptoService.hashOpaqueToken(first), first);
});

test("compares CSRF tokens without early string comparison", () => {
  assert.equal(cryptoService.tokensEqual("same", "same"), true);
  assert.equal(cryptoService.tokensEqual("same", "different"), false);
});

test("derives deterministic email token without persisting it in events", () => {
  const expiresAt = new Date("2026-07-28T20:00:00.000Z");
  const first = cryptoService.emailVerificationToken(
    "01900000-0000-7000-8000-000000000001",
    "01900000-0000-7000-8000-000000000002",
    expiresAt
  );
  const second = cryptoService.emailVerificationToken(
    "01900000-0000-7000-8000-000000000001",
    "01900000-0000-7000-8000-000000000002",
    expiresAt
  );

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u);
});

test("derives deterministic invitation token without persisting it in events", () => {
  const expiresAt = new Date("2026-08-04T20:00:00.000Z");
  const first = cryptoService.workspaceInvitationToken(
    "01900000-0000-7000-8000-000000000003",
    "01900000-0000-7000-8000-000000000004",
    "member@example.com",
    expiresAt
  );
  const second = cryptoService.workspaceInvitationToken(
    "01900000-0000-7000-8000-000000000003",
    "01900000-0000-7000-8000-000000000004",
    "member@example.com",
    expiresAt
  );

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u);
});

test("derives deterministic password reset token", () => {
  const expiresAt = new Date("2026-07-28T21:00:00.000Z");
  const first = cryptoService.passwordResetToken(
    "01900000-0000-7000-8000-000000000005",
    "01900000-0000-7000-8000-000000000006",
    expiresAt
  );
  const second = cryptoService.passwordResetToken(
    "01900000-0000-7000-8000-000000000005",
    "01900000-0000-7000-8000-000000000006",
    expiresAt
  );

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u);
});

test("encrypts MFA secrets with authenticated encryption", () => {
  const first = cryptoService.encryptMfaSecret("BASE32SECRET");
  const second = cryptoService.encryptMfaSecret("BASE32SECRET");

  assert.notEqual(first, second);
  assert.equal(cryptoService.decryptMfaSecret(first), "BASE32SECRET");
  const parts = first.split(".");
  const encrypted = Buffer.from(parts[3]!, "base64url");
  encrypted[0] = encrypted[0]! ^ 1;
  parts[3] = encrypted.toString("base64url");
  assert.throws(
    () => cryptoService.decryptMfaSecret(parts.join(".")),
    { message: "Invalid encrypted MFA secret" }
  );
});
