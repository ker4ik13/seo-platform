import assert from "node:assert/strict";
import test from "node:test";
import { BrowserApiError } from "./browser-api.ts";
import {
  formatSessionActivity,
  formatSessionDate,
  loadAllUserSessions,
  parseUserSessions,
  parseRevokedSessionCount,
  REVOKED_SESSION_LOGIN_PATH,
  REVOKE_OTHER_SESSIONS_PATH,
  SESSION_LIST_AUTH_REFRESH_PATH,
  sessionDevicePresentation,
  sessionIpLabel,
  sessionListAuthenticationRedirect,
  sessionListHealth,
  sessionLocationLabel,
  sessionRequestErrorMessage,
  sessionRevocationSucceeded,
  sessionRevokePath,
  sessionSettingsViewState,
  SESSIONS_PATH,
  withoutOtherSessions,
  withoutRevokedSession
} from "./session-management.ts";

const CURRENT_SESSION = {
  id: "01900000-0000-7000-8000-000000000001",
  authenticatedAt: "2026-07-30T08:00:00.000Z",
  accessExpiresAt: "2026-07-30T08:15:00.000Z",
  expiresAt: "2026-08-29T08:00:00.000Z",
  current: true,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
  ipAddress: "192.0.2.10",
  lastUsedAt: "2026-07-30T08:04:00.000Z",
  createdAt: "2026-07-30T08:00:00.000Z"
} as const;

const OTHER_SESSION = {
  ...CURRENT_SESSION,
  id: "01900000-0000-7000-8000-000000000002",
  current: false,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
  ipAddress: "2001:db8::1"
} as const;

test("parses the exact bounded session collection contract", () => {
  const sessions = parseUserSessions([CURRENT_SESSION, OTHER_SESSION]);
  assert.deepEqual(sessions, [CURRENT_SESSION, OTHER_SESSION]);
  assert.equal(sessionListHealth(sessions), "READY");
  assert.equal(sessionListHealth([]), "EMPTY");
  assert.equal(
    sessionListHealth([{ ...OTHER_SESSION, current: false }]),
    "CURRENT_SESSION_MISSING"
  );
});

test("rejects malformed, duplicate and ambiguous current session projections", () => {
  for (const invalid of [
    [{ ...CURRENT_SESSION, privateToken: "must-not-pass" }],
    [{ ...CURRENT_SESSION, id: "not-a-uuid" }],
    [{ ...CURRENT_SESSION, current: "yes" }],
    [{ ...CURRENT_SESSION, userAgent: "Browser\u202eexe" }],
    [{ ...CURRENT_SESSION, ipAddress: "192.0.2.1 extra" }],
    [
      CURRENT_SESSION,
      { ...CURRENT_SESSION, id: OTHER_SESSION.id }
    ],
    [CURRENT_SESSION, CURRENT_SESSION]
  ]) {
    assert.throws(
      () => parseUserSessions(invalid),
      (error: unknown) =>
        error instanceof BrowserApiError &&
        error.code === "INVALID_RESPONSE"
    );
  }
});

test("rejects impossible session chronology and malformed timestamps", () => {
  for (const invalid of [
    { ...CURRENT_SESSION, createdAt: "not-a-date" },
    {
      ...CURRENT_SESSION,
      lastUsedAt: "2026-07-30T07:59:59.000Z"
    },
    {
      ...CURRENT_SESSION,
      accessExpiresAt: "2026-07-30T07:59:59.000Z"
    },
    {
      ...CURRENT_SESSION,
      expiresAt: "2026-07-30T08:00:00.000Z"
    }
  ]) {
    assert.throws(() => parseUserSessions([invalid]));
  }

  assert.doesNotThrow(() =>
    parseUserSessions([
      {
        ...CURRENT_SESSION,
        createdAt: "2026-07-30T08:00:00.015Z"
      }
    ])
  );
});

test("derives every loading, empty, error, degraded and ready component state", () => {
  assert.equal(
    sessionSettingsViewState({
      sessions: undefined,
      loading: true,
      online: true,
      hasLoadError: false
    }),
    "LOADING"
  );
  assert.equal(
    sessionSettingsViewState({
      sessions: undefined,
      loading: false,
      online: false,
      hasLoadError: true
    }),
    "OFFLINE"
  );
  assert.equal(
    sessionSettingsViewState({
      sessions: undefined,
      loading: false,
      online: true,
      hasLoadError: true
    }),
    "ERROR"
  );
  assert.equal(
    sessionSettingsViewState({
      sessions: [],
      loading: false,
      online: true,
      hasLoadError: false
    }),
    "EMPTY"
  );
  assert.equal(
    sessionSettingsViewState({
      sessions: [CURRENT_SESSION],
      loading: false,
      online: false,
      hasLoadError: false
    }),
    "DEGRADED"
  );
  assert.equal(
    sessionSettingsViewState({
      sessions: [CURRENT_SESSION],
      loading: false,
      online: true,
      hasLoadError: true
    }),
    "DEGRADED"
  );
  assert.equal(
    sessionSettingsViewState({
      sessions: [OTHER_SESSION],
      loading: false,
      online: true,
      hasLoadError: false
    }),
    "CURRENT_SESSION_MISSING"
  );
  assert.equal(
    sessionSettingsViewState({
      sessions: [CURRENT_SESSION],
      loading: false,
      online: true,
      hasLoadError: false
    }),
    "READY"
  );
});

test("presents common desktop, mobile, tablet and unknown devices", () => {
  assert.deepEqual(
    sessionDevicePresentation(CURRENT_SESSION.userAgent),
    {
      title: "Google Chrome · macOS",
      browser: "Google Chrome",
      platform: "macOS",
      kind: "desktop",
      monogram: "ПК"
    }
  );
  assert.deepEqual(
    sessionDevicePresentation(OTHER_SESSION.userAgent),
    {
      title: "Safari · iOS/iPadOS",
      browser: "Safari",
      platform: "iOS/iPadOS",
      kind: "mobile",
      monogram: "М"
    }
  );
  assert.deepEqual(
    sessionDevicePresentation(
      "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
    ),
    {
      title: "Google Chrome · Android",
      browser: "Google Chrome",
      platform: "Android",
      kind: "tablet",
      monogram: "ПЛ"
    }
  );
  assert.deepEqual(sessionDevicePresentation(undefined), {
    title: "Неизвестное устройство",
    browser: "Браузер не определён",
    platform: "Система не определена",
    kind: "unknown",
    monogram: "?"
  });
});

test("uses specific browser precedence for branded Chromium agents", () => {
  assert.equal(
    sessionDevicePresentation(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 YaBrowser/24.7 Safari/537.36"
    ).browser,
    "Яндекс Браузер"
  );
  assert.equal(
    sessionDevicePresentation(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Edg/126.0 Safari/537.36"
    ).browser,
    "Microsoft Edge"
  );
  assert.equal(
    sessionDevicePresentation(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 OPR/112.0 Safari/537.36"
    ).browser,
    "Opera"
  );
});

test("formats activity and metadata without inventing geography", () => {
  const now = Date.parse("2026-07-30T10:00:00.000Z");
  assert.equal(
    formatSessionActivity("2026-07-30T09:59:40.000Z", now),
    "только что"
  );
  assert.equal(
    formatSessionActivity("2026-07-30T09:42:00.000Z", now),
    "18 мин назад"
  );
  assert.equal(
    formatSessionActivity("2026-07-30T04:00:00.000Z", now),
    "6 ч назад"
  );
  assert.equal(
    formatSessionActivity("2026-07-28T10:00:00.000Z", now),
    formatSessionDate("2026-07-28T10:00:00.000Z")
  );
  assert.equal(sessionIpLabel("192.0.2.10"), "IP 192.0.2.10");
  assert.equal(sessionIpLabel(undefined), "IP не определён");
  assert.equal(sessionLocationLabel(), "Геопозиция не определена");
});

test("builds only same-origin BFF session paths", () => {
  assert.equal(SESSIONS_PATH, "/app/api/sessions");
  assert.equal(
    REVOKE_OTHER_SESSIONS_PATH,
    "/app/api/sessions/others"
  );
  assert.equal(
    sessionRevokePath(CURRENT_SESSION.id),
    `/app/api/sessions/${CURRENT_SESSION.id}`
  );
  assert.equal(
    REVOKED_SESSION_LOGIN_PATH,
    "/app/login?reason=session-revoked"
  );
  assert.throws(() => sessionRevokePath("../internal"));
});

test("loads every active-session cursor page without exposing a partial list", async () => {
  const paths: string[] = [];
  const signal = new AbortController().signal;
  const sessions = await loadAllUserSessions({
    signal,
    request: async (path, forwardedSignal) => {
      paths.push(path);
      assert.equal(forwardedSignal, signal);
      if (paths.length === 1) {
        return {
          data: [CURRENT_SESSION],
          page: {
            hasNext: true,
            nextCursor: "cursor_page_2"
          }
        };
      }
      return {
        data: [OTHER_SESSION],
        page: { hasNext: false }
      };
    }
  });

  assert.deepEqual(sessions, [CURRENT_SESSION, OTHER_SESSION]);
  assert.deepEqual(paths, [
    "/app/api/sessions?limit=100",
    "/app/api/sessions?limit=100&cursor=cursor_page_2"
  ]);
});

test("fails closed for broken, repeated or ambiguous session pagination", async () => {
  await assert.rejects(
    loadAllUserSessions({
      request: async () => ({
        data: [CURRENT_SESSION],
        page: { hasNext: true }
      })
    }),
    (error: unknown) =>
      error instanceof BrowserApiError && error.code === "INVALID_RESPONSE"
  );

  let calls = 0;
  await assert.rejects(
    loadAllUserSessions({
      request: async () => {
        calls += 1;
        return {
          data: calls === 1 ? [CURRENT_SESSION] : [],
          page: {
            hasNext: true,
            nextCursor: "same_cursor_1"
          }
        };
      }
    }),
    (error: unknown) =>
      error instanceof BrowserApiError && error.code === "INVALID_RESPONSE"
  );
  assert.equal(calls, 2);

  await assert.rejects(
    loadAllUserSessions({
      request: async (path) => ({
        data: path.includes("cursor")
          ? [{ ...OTHER_SESSION, current: true }]
          : [CURRENT_SESSION],
        page: path.includes("cursor")
          ? { hasNext: false }
          : { hasNext: true, nextCursor: "cursor_page_2" }
      })
    }),
    (error: unknown) =>
      error instanceof BrowserApiError && error.code === "INVALID_RESPONSE"
  );
});

test("reports the bounded page ceiling without returning a partial session list", async () => {
  let calls = 0;
  await assert.rejects(
    loadAllUserSessions({
      request: async () => {
        calls += 1;
        return {
          data: [],
          page: {
            hasNext: true,
            nextCursor: `cursor_page_${String(calls).padStart(2, "0")}`
          }
        };
      }
    }),
    (error: unknown) =>
      error instanceof BrowserApiError &&
      error.code === "SESSION_LIST_LIMIT_EXCEEDED" &&
      sessionRequestErrorMessage(error, "fallback").includes(
        "Частичный список скрыт"
      )
  );
  assert.equal(calls, 25);
});

test("routes session-list 401 through refresh before declaring terminal revoke", () => {
  assert.equal(
    sessionListAuthenticationRedirect(
      new BrowserApiError(401, "UNAUTHENTICATED", "private")
    ),
    SESSION_LIST_AUTH_REFRESH_PATH
  );
  assert.equal(
    SESSION_LIST_AUTH_REFRESH_PATH,
    "/app/auth/refresh?returnTo=%2Fapp%2Fsettings%2Fsecurity"
  );
  assert.equal(
    sessionListAuthenticationRedirect(
      new BrowserApiError(503, "UNAVAILABLE", "private")
    ),
    undefined
  );
});

test("projects optimistic results for individual and revoke-others operations", () => {
  const sessions = parseUserSessions([CURRENT_SESSION, OTHER_SESSION]);
  assert.deepEqual(withoutRevokedSession(sessions, OTHER_SESSION.id), [
    CURRENT_SESSION
  ]);
  assert.deepEqual(withoutRevokedSession(sessions, "missing"), sessions);
  assert.deepEqual(withoutOtherSessions(sessions), [CURRENT_SESSION]);
  assert.deepEqual(
    withoutOtherSessions([
      { ...CURRENT_SESSION, current: false },
      OTHER_SESSION
    ]),
    []
  );
});

test("treats only a concurrent session 404 as idempotent success", () => {
  assert.equal(
    sessionRevocationSucceeded(
      new BrowserApiError(404, "NOT_FOUND", "Session not found")
    ),
    true
  );
  assert.equal(
    sessionRevocationSucceeded(
      new BrowserApiError(409, "CONFLICT", "Conflict")
    ),
    false
  );
  assert.equal(sessionRevocationSucceeded(new Error("network")), false);
});

test("accepts only an exact nonnegative revoke-others response", () => {
  assert.equal(parseRevokedSessionCount({ revoked: 0 }), 0);
  assert.equal(parseRevokedSessionCount({ revoked: 101 }), 101);
  for (const invalid of [
    { revoked: -1 },
    { revoked: 1.5 },
    { revoked: 1, private: true },
    { count: 1 }
  ]) {
    assert.throws(() => parseRevokedSessionCount(invalid));
  }
});

test("maps authentication, CSRF and retryable failures to safe UI copy", () => {
  assert.equal(
    sessionRequestErrorMessage(
      new BrowserApiError(401, "UNAUTHENTICATED", "private"),
      "fallback"
    ),
    "Сессия завершена. Войдите в аккаунт снова."
  );
  assert.match(
    sessionRequestErrorMessage(
      new BrowserApiError(403, "FORBIDDEN", "private"),
      "fallback"
    ),
    /Обновите страницу/u
  );
  assert.match(
    sessionRequestErrorMessage(
      new BrowserApiError(503, "UNAVAILABLE", "private"),
      "fallback"
    ),
    /временно недоступен/u
  );
  assert.equal(
    sessionRequestErrorMessage(new Error("private"), "fallback"),
    "fallback"
  );
});
