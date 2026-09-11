import assert from "node:assert/strict";
import test from "node:test";
import {
  coalescedServerSessionRefresh,
  coordinatedBrowserSessionRefresh,
  type BrowserSessionRefreshLockManager
} from "./session-refresh-coordination.ts";

test("a tab reuses cookies rotated by a peer while it waited for the browser lock", async () => {
  let csrf = "old-csrf";
  let refreshCalls = 0;
  const locks: BrowserSessionRefreshLockManager = {
    request: async (_name, options, callback) => {
      assert.deepEqual(options, { mode: "exclusive" });
      csrf = "peer-rotated-csrf";
      return callback();
    }
  };

  assert.equal(
    await coordinatedBrowserSessionRefresh(
      "old-csrf",
      () => csrf,
      async () => {
        refreshCalls += 1;
        return true;
      },
      locks
    ),
    true
  );
  assert.equal(refreshCalls, 0);
});

test("the lock owner rotates when no peer changed the session cookies", async () => {
  let receivedCsrf: string | undefined;
  assert.equal(
    await coordinatedBrowserSessionRefresh(
      "current-csrf",
      () => "current-csrf",
      async (csrf) => {
        receivedCsrf = csrf;
        return true;
      }
    ),
    true
  );
  assert.equal(receivedCsrf, "current-csrf");
});

test("the BFF sends one upstream rotation for simultaneous matching requests", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const refresh = async () => {
    calls += 1;
    await gate;
    return Response.json(
      { data: { refreshed: true } },
      { status: 200, headers: { "Set-Cookie": "seo_csrf=next; Path=/" } }
    );
  };

  const first = coalescedServerSessionRefresh("same-browser", refresh);
  const second = coalescedServerSessionRefresh("same-browser", refresh);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(
    await Promise.all(responses.map((response) => response.json())),
    [{ data: { refreshed: true } }, { data: { refreshed: true } }]
  );
  assert.equal(calls, 1);
  assert.equal(responses[0]?.headers.get("set-cookie"), "seo_csrf=next; Path=/");
  assert.equal(responses[1]?.headers.get("set-cookie"), "seo_csrf=next; Path=/");

  await coalescedServerSessionRefresh("same-browser", refresh);
  assert.equal(calls, 2, "a completed refresh must not create a replay window");
});

test("the BFF never coalesces different browser session fingerprints", async () => {
  let calls = 0;
  const refresh = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };
  await Promise.all([
    coalescedServerSessionRefresh("first-browser", refresh),
    coalescedServerSessionRefresh("second-browser", refresh)
  ]);
  assert.equal(calls, 2);
});
