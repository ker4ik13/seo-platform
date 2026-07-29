import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { proxyPlatformApi } from "./platform-api-proxy.ts";

test("proxies an assignment PUT through the safe same-origin BFF", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl: string | undefined;
  let upstreamInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    upstreamUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    upstreamInit = init;
    return Response.json({
      data: {
        contextId: "context-id",
        keywordId: "keyword-id",
        assigned: true
      }
    });
  };

  try {
    const request = new NextRequest(
      "http://localhost/app/api/projects/project-id/tracking-contexts/context-id/keywords/keyword-id",
      {
        method: "PUT",
        headers: {
          Cookie: "seo_session=session",
          "X-CSRF-Token": "csrf"
        }
      }
    );
    const response = await proxyPlatformApi(request, [
      "projects",
      "project-id",
      "tracking-contexts",
      "context-id",
      "keywords",
      "keyword-id"
    ]);

    assert.equal(response.status, 200);
    assert.equal(
      upstreamUrl,
      "http://localhost:4000/api/v1/projects/project-id/tracking-contexts/context-id/keywords/keyword-id"
    );
    assert.equal(upstreamInit?.method, "PUT");
    const headers = new Headers(upstreamInit?.headers);
    assert.equal(headers.get("x-csrf-token"), "csrf");
    assert.equal(headers.get("cookie"), "seo_session=session");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards the original browser user agent to Platform API", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    forwardedHeaders = new Headers(init?.headers);
    return Response.json({ data: { devices: [] } });
  };

  try {
    const request = new NextRequest(
      "http://localhost/app/api/me/push-subscriptions",
      {
        headers: {
          Cookie: "seo_session=session",
          "User-Agent": "Browser Product/123"
        }
      }
    );
    const response = await proxyPlatformApi(request, [
      "me",
      "push-subscriptions"
    ]);

    assert.equal(response.status, 200);
    assert.equal(forwardedHeaders?.get("user-agent"), "Browser Product/123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("applies a narrow body limit to push subscription secrets", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return Response.json({ data: {} });
  };

  try {
    const request = new NextRequest(
      "http://localhost/app/api/me/push-subscriptions/installation-id",
      {
        method: "PUT",
        body: new Uint8Array(8 * 1_024 + 1),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf"
        }
      }
    );
    const response = await proxyPlatformApi(request, [
      "me",
      "push-subscriptions",
      "installation-id"
    ]);

    assert.equal(response.status, 413);
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a streamed body that exceeds the BFF limit", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return Response.json({ data: {} });
  };

  try {
    const oversized = new Uint8Array(2 * 1_024 * 1_024 + 1);
    const request = new NextRequest(
      "http://localhost/app/api/projects/project-id/tracking-contexts",
      {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          }
        }),
        duplex: "half"
      }
    );
    const response = await proxyPlatformApi(request, [
      "projects",
      "project-id",
      "tracking-contexts"
    ]);

    assert.equal(response.status, 413);
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards a bounded request body after measuring it", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedBody: BodyInit | null | undefined;
  globalThis.fetch = async (_input, init) => {
    forwardedBody = init?.body;
    return Response.json({ data: { accepted: true } });
  };

  try {
    const request = new NextRequest(
      "http://localhost/app/api/projects/project-id/tracking-contexts",
      {
        method: "POST",
        body: JSON.stringify({ name: "Google US" }),
        headers: { "Content-Type": "application/json" }
      }
    );
    const response = await proxyPlatformApi(request, [
      "projects",
      "project-id",
      "tracking-contexts"
    ]);

    assert.equal(response.status, 200);
    assert.equal(
      await new Response(forwardedBody).text(),
      JSON.stringify({ name: "Google US" })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
