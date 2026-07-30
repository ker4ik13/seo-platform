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

test("forwards a manual rank create with CSRF and Idempotency-Key", async () => {
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
    return Response.json(
      {
        data: {
          id: "01900000-0000-7000-8000-000000000004",
          status: "PREPARING"
        }
      },
      { status: 202 }
    );
  };

  try {
    const body = JSON.stringify({
      estimateId: "01900000-0000-7000-8000-000000000005"
    });
    const request = new NextRequest(
      "http://localhost/app/api/projects/01900000-0000-7000-8000-000000000002/rank-runs",
      {
        method: "POST",
        body,
        headers: {
          Cookie: "seo_session=session",
          "Content-Type": "application/json",
          "Idempotency-Key": "rank-run:command-1",
          "X-CSRF-Token": "csrf"
        }
      }
    );
    const response = await proxyPlatformApi(request, [
      "projects",
      "01900000-0000-7000-8000-000000000002",
      "rank-runs"
    ]);

    assert.equal(response.status, 202);
    assert.equal(
      upstreamUrl,
      "http://localhost:4000/api/v1/projects/01900000-0000-7000-8000-000000000002/rank-runs"
    );
    const headers = new Headers(upstreamInit?.headers);
    assert.equal(headers.get("idempotency-key"), "rank-run:command-1");
    assert.equal(headers.get("x-csrf-token"), "csrf");
    assert.equal(headers.get("cookie"), "seo_session=session");
    assert.equal(
      await new Response(upstreamInit?.body).text(),
      body
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards an exact empty cooperative rank cancel command", async () => {
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
        id: "01900000-0000-7000-8000-000000000004",
        status: "CANCEL_REQUESTED"
      }
    });
  };

  try {
    const request = new NextRequest(
      "http://localhost/app/api/projects/01900000-0000-7000-8000-000000000002/jobs/01900000-0000-7000-8000-000000000004/cancel",
      {
        method: "POST",
        body: "{}",
        headers: {
          Cookie: "seo_session=session",
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf"
        }
      }
    );
    const response = await proxyPlatformApi(request, [
      "projects",
      "01900000-0000-7000-8000-000000000002",
      "jobs",
      "01900000-0000-7000-8000-000000000004",
      "cancel"
    ]);

    assert.equal(response.status, 200);
    assert.equal(
      upstreamUrl,
      "http://localhost:4000/api/v1/projects/01900000-0000-7000-8000-000000000002/jobs/01900000-0000-7000-8000-000000000004/cancel"
    );
    const headers = new Headers(upstreamInit?.headers);
    assert.equal(headers.get("x-csrf-token"), "csrf");
    assert.equal(headers.get("idempotency-key"), null);
    assert.equal(
      await new Response(upstreamInit?.body).text(),
      "{}"
    );
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

test("proxies session revoke with server-only cookies and returns cookie clearing", async () => {
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
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie":
          "seo_session=; Path=/app; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
      }
    });
  };

  try {
    const sessionId = "01900000-0000-7000-8000-000000000001";
    const request = new NextRequest(
      `http://localhost/app/api/sessions/${sessionId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: "test-only-authorization-header",
          Cookie: "seo_session=server-only-session",
          "X-CSRF-Token": "public-csrf-value"
        }
      }
    );
    const response = await proxyPlatformApi(request, [
      "sessions",
      sessionId
    ]);

    assert.equal(response.status, 204);
    assert.equal(
      upstreamUrl,
      `http://localhost:4000/api/v1/sessions/${sessionId}`
    );
    assert.equal(upstreamInit?.method, "DELETE");
    assert.equal(upstreamInit?.redirect, "manual");
    const headers = new Headers(upstreamInit?.headers);
    assert.equal(headers.get("cookie"), "seo_session=server-only-session");
    assert.equal(headers.get("x-csrf-token"), "public-csrf-value");
    assert.equal(headers.get("authorization"), null);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/u);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards only one validated edge client IP to Platform API", async () => {
  const originalFetch = globalThis.fetch;
  const forwarded: Headers[] = [];
  globalThis.fetch = async (_input, init) => {
    forwarded.push(new Headers(init?.headers));
    return Response.json({ data: [] });
  };

  try {
    for (const [input, expected] of [
      ["203.0.113.19", "203.0.113.19"],
      ["2001:DB8::A", "2001:db8::a"],
      ["2001:0DB8:0:0:0:0:0:A", "2001:db8::a"]
    ] as const) {
      const request = new NextRequest(
        "http://localhost/app/api/sessions?limit=100",
        {
          headers: {
            Forwarded: "for=198.51.100.8",
            "X-Forwarded-For": input,
            "X-Real-IP": "198.51.100.9"
          }
        }
      );
      const response = await proxyPlatformApi(request, ["sessions"]);
      assert.equal(response.status, 200);
      const headers = forwarded.at(-1)!;
      assert.equal(headers.get("x-forwarded-for"), expected);
      assert.equal(headers.get("forwarded"), null);
      assert.equal(headers.get("x-real-ip"), null);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects chained or malformed forwarded client addresses before upstream", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json({ data: [] });
  };

  try {
    for (const value of [
      "203.0.113.19, 10.0.0.1",
      "unknown",
      "[2001:db8::1]",
      "fe80::1%eth0",
      "999.1.1.1"
    ]) {
      const request = new NextRequest(
        "http://localhost/app/api/sessions",
        { headers: { "X-Forwarded-For": value } }
      );
      const response = await proxyPlatformApi(request, ["sessions"]);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards only the exact same browser Origin required by realtime tickets", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  let upstreamHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    upstreamCalls += 1;
    upstreamHeaders = new Headers(init?.headers);
    return Response.json({ data: { ok: true } });
  };

  try {
    const accepted = await proxyPlatformApi(
      new NextRequest(
        "https://app.example.test/app/api/projects/01900000-0000-7000-8000-000000000001/realtime-tickets",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://app.example.test"
          },
          body: JSON.stringify({
            clientInstanceId:
              "01900000-0000-7000-8000-000000000002"
          })
        }
      ),
      [
        "projects",
        "01900000-0000-7000-8000-000000000001",
        "realtime-tickets"
      ]
    );
    assert.equal(accepted.status, 200);
    assert.equal(
      upstreamHeaders?.get("origin"),
      "https://app.example.test"
    );

    for (const origin of [
      "https://attacker.example.test",
      "https://app.example.test/",
      "null"
    ]) {
      const rejected = await proxyPlatformApi(
        new NextRequest(
          "https://app.example.test/app/api/projects/01900000-0000-7000-8000-000000000001/realtime-tickets",
          {
            method: "POST",
            headers: { Origin: origin },
            body: "{}"
          }
        ),
        [
          "projects",
          "01900000-0000-7000-8000-000000000001",
          "realtime-tickets"
        ]
      );
      assert.equal(rejected.status, 403);
      assert.equal(
        rejected.headers.get("cache-control"),
        "private, no-store"
      );
    }
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts the configured public Origin behind a reverse proxy", async () => {
  const originalFetch = globalThis.fetch;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  let upstreamHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    upstreamHeaders = new Headers(init?.headers);
    return Response.json({ data: { ok: true } });
  };
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test:8443";

  try {
    const response = await proxyPlatformApi(
      new NextRequest(
        "http://localhost:3100/app/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://app.example.test:8443"
          },
          body: JSON.stringify({
            email: "preview@example.test",
            password: "not-a-real-password"
          })
        }
      ),
      ["auth", "login"]
    );

    assert.equal(response.status, 200);
    assert.equal(
      upstreamHeaders?.get("origin"),
      "https://app.example.test:8443"
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    }
  }
});
