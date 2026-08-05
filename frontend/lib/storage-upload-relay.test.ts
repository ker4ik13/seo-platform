import assert from "node:assert/strict";
import test from "node:test";
import { relayObjectStorageUpload } from "./storage-upload-relay.ts";

const publicOrigin = "https://144.31.221.28:3000";
const signedUrl =
  "https://144.31.221.28:9443/uploads/file?partNumber=1&uploadId=upload-1&X-Amz-Signature=signature";

test("streams an upload part only to the same-host storage endpoint", async () => {
  const previousSiteUrl = process.env.WEB_PUBLIC_URL;
  process.env.WEB_PUBLIC_URL = publicOrigin;
  const previousFetch = globalThis.fetch;
  let forwardedBody = "";
  let forwardedUrl = "";
  globalThis.fetch = (async (input, init) => {
    forwardedUrl = String(input);
    forwardedBody = await new Response(init?.body).text();
    return new Response(null, {
      status: 200,
      headers: { ETag: '"etag-1"' }
    });
  }) as typeof fetch;

  try {
    const response = await relayObjectStorageUpload(
      new Request(`${publicOrigin}/app/api/storage-upload`, {
        method: "PUT",
        headers: {
          Origin: publicOrigin,
          "Content-Type": "application/octet-stream",
          "x-seo-storage-url": signedUrl
        },
        body: "semantic-file",
        duplex: "half"
      } as RequestInit & { duplex: "half" })
    );

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("etag"), '"etag-1"');
    assert.equal(forwardedUrl, signedUrl);
    assert.equal(forwardedBody, "semantic-file");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSiteUrl === undefined) {
      delete process.env.WEB_PUBLIC_URL;
    } else {
      process.env.WEB_PUBLIC_URL = previousSiteUrl;
    }
  }
});

test("rejects cross-origin and arbitrary storage relay targets", async () => {
  const previousSiteUrl = process.env.WEB_PUBLIC_URL;
  process.env.WEB_PUBLIC_URL = publicOrigin;
  try {
    const crossOrigin = await relayObjectStorageUpload(
      new Request(`${publicOrigin}/app/api/storage-upload`, {
        method: "PUT",
        headers: {
          Origin: "https://attacker.example",
          "x-seo-storage-url": signedUrl
        },
        body: "part"
      })
    );
    assert.equal(crossOrigin.status, 403);

    const arbitraryTarget = await relayObjectStorageUpload(
      new Request(`${publicOrigin}/app/api/storage-upload`, {
        method: "PUT",
        headers: {
          Origin: publicOrigin,
          "x-seo-storage-url":
            "https://metadata.example:9443/file?partNumber=1&uploadId=x&X-Amz-Signature=x"
        },
        body: "part"
      })
    );
    assert.equal(arbitraryTarget.status, 400);
  } finally {
    if (previousSiteUrl === undefined) {
      delete process.env.WEB_PUBLIC_URL;
    } else {
      process.env.WEB_PUBLIC_URL = previousSiteUrl;
    }
  }
});
