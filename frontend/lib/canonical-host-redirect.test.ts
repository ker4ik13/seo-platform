import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHostRedirectUrl } from "./canonical-host-redirect.ts";

const env = {
  NODE_ENV: "production",
  WEB_PUBLIC_URL: "https://seonorita.ru",
  WEB_WWW_REDIRECT_HOST: "www.seonorita.ru"
} as const;

test("redirects the configured www host to the canonical origin", () => {
  const redirected = canonicalHostRedirectUrl(
    new URL("https://www.seonorita.ru/app/semantics?group=one"),
    "www.seonorita.ru",
    env
  );

  assert.equal(
    redirected?.toString(),
    "https://seonorita.ru/app/semantics?group=one"
  );
});

test("accepts a proxy host port and ignores canonical or unrelated hosts", () => {
  assert.equal(
    canonicalHostRedirectUrl(
      new URL("https://www.seonorita.ru/ru"),
      "www.seonorita.ru:443",
      env
    )?.toString(),
    "https://seonorita.ru/ru"
  );
  assert.equal(
    canonicalHostRedirectUrl(
      new URL("https://seonorita.ru/ru"),
      "seonorita.ru",
      env
    ),
    undefined
  );
  assert.equal(
    canonicalHostRedirectUrl(
      new URL("https://attacker.example/ru"),
      "attacker.example",
      env
    ),
    undefined
  );
});
