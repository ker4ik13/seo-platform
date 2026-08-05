import assert from "node:assert/strict";
import test from "node:test";
import {
  fragmentFreeBrowserPath,
  oneTimeTokenFromFragment,
  readOneTimeTokenFragment
} from "./one-time-link.ts";

const TOKEN =
  "01900000-0000-7000-8000-000000000001.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

test("parses one exact opaque token from a URL fragment", () => {
  assert.equal(oneTimeTokenFromFragment(`#token=${TOKEN}`), TOKEN);
  assert.equal(
    oneTimeTokenFromFragment(`#token=${encodeURIComponent(TOKEN)}`),
    TOKEN
  );
});

test("rejects ambiguous, malformed and oversized one-time fragments", () => {
  for (const fragment of [
    "",
    `?token=${TOKEN}`,
    `#token=${TOKEN}&token=${TOKEN}`,
    `#token=${TOKEN}&next=/app`,
    "#token=short",
    `#token=%20${TOKEN}`,
    "#token=01900000-0000-7000-8000-000000000001.invalid+token"
  ]) {
    assert.equal(oneTimeTokenFromFragment(fragment), undefined, fragment);
  }
  assert.equal(oneTimeTokenFromFragment(`#token=${TOKEN}`, 79), undefined);
});

test("requests immediate scrub for valid and malformed non-empty fragments", () => {
  assert.deepEqual(readOneTimeTokenFragment(`#token=${TOKEN}`), {
    shouldScrub: true,
    token: TOKEN
  });
  assert.deepEqual(
    readOneTimeTokenFragment(`#token=${TOKEN}&next=/app`),
    { shouldScrub: true }
  );
  assert.deepEqual(readOneTimeTokenFragment("#invalid"), {
    shouldScrub: true
  });
  assert.deepEqual(readOneTimeTokenFragment(""), {
    shouldScrub: false
  });
});

test("removes only the fragment while preserving path and safe query state", () => {
  assert.equal(
    fragmentFreeBrowserPath({
      pathname: "/app/verify-email",
      search: "?email=user%40example.com"
    } as Location),
    "/app/verify-email?email=user%40example.com"
  );
});
