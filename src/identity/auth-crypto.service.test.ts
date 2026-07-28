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
