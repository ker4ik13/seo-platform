import assert from "node:assert/strict";
import test from "node:test";
import {
  platformApiInternalOrigin,
  webPublicOrigin
} from "./server-runtime-origin.ts";

test("returns explicit canonical runtime origins", () => {
  assert.equal(
    webPublicOrigin({
      NODE_ENV: "production",
      WEB_PUBLIC_URL: "https://seo.example.test"
    }),
    "https://seo.example.test"
  );
  assert.equal(
    platformApiInternalOrigin({
      NODE_ENV: "test",
      PLATFORM_API_INTERNAL_URL: "http://backend-core:4000"
    }),
    "http://backend-core:4000"
  );
});

test("rejects missing, local and non-canonical public origins", () => {
  assert.throws(() => webPublicOrigin({ NODE_ENV: "production" }));
  assert.throws(() =>
    webPublicOrigin({
      NODE_ENV: "production",
      WEB_PUBLIC_URL: "http://localhost:3000"
    })
  );
  assert.throws(() =>
    webPublicOrigin({
      NODE_ENV: "production",
      WEB_PUBLIC_URL: "https://seo.example.test/path"
    })
  );
});
