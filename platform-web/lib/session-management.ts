import type { UserSessionSummary } from "@seo-platform/contracts";
import {
  browserApiCollectionRequest,
  BrowserApiError
} from "./browser-api.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_OR_BIDI_CHARACTERS =
  /[\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069]/u;
const MAX_USER_AGENT_LENGTH = 2_000;
const MAX_IP_ADDRESS_LENGTH = 64;
const SESSION_PAGE_LIMIT = 100;
const MAX_SESSION_PAGES = 25;
const SESSION_CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,512}$/u;

const REQUIRED_SESSION_KEYS = [
  "id",
  "authenticatedAt",
  "accessExpiresAt",
  "expiresAt",
  "current",
  "lastUsedAt",
  "createdAt"
] as const;
const OPTIONAL_SESSION_KEYS = ["userAgent", "ipAddress"] as const;

export const SESSIONS_PATH = "/app/api/sessions";
export const REVOKE_OTHER_SESSIONS_PATH = `${SESSIONS_PATH}/others`;
export const REVOKED_SESSION_LOGIN_PATH =
  "/app/login?reason=session-revoked";
export const SESSION_LIST_AUTH_REFRESH_PATH =
  "/app/auth/refresh?returnTo=%2Fapp%2Fsettings%2Fsecurity";

export type SessionDeviceKind = "desktop" | "mobile" | "tablet" | "unknown";

export interface SessionDevicePresentation {
  readonly title: string;
  readonly browser: string;
  readonly platform: string;
  readonly kind: SessionDeviceKind;
  readonly monogram: string;
}

export type SessionListHealth =
  | "EMPTY"
  | "READY"
  | "CURRENT_SESSION_MISSING";

export type SessionSettingsViewState =
  | "LOADING"
  | "OFFLINE"
  | "ERROR"
  | "EMPTY"
  | "DEGRADED"
  | "CURRENT_SESSION_MISSING"
  | "READY";

interface SessionCollectionPage {
  readonly data: readonly unknown[];
  readonly page: {
    readonly hasNext: boolean;
    readonly nextCursor?: string;
  };
}

type SessionPageRequester = (
  path: string,
  signal?: AbortSignal
) => Promise<SessionCollectionPage>;

export async function loadAllUserSessions(
  options: {
    readonly signal?: AbortSignal;
    readonly request?: SessionPageRequester;
  } = {}
): Promise<readonly UserSessionSummary[]> {
  const request =
    options.request ??
    ((path: string, signal?: AbortSignal) =>
      browserApiCollectionRequest<unknown>(
        path,
        signal ? { signal } : {}
      ));
  const cursors = new Set<string>();
  const combined: unknown[] = [];
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_SESSION_PAGES; pageNumber += 1) {
    const page = await request(sessionListPath(cursor), options.signal);
    combined.push(...page.data);
    const sessions = parseUserSessions(combined);
    if (!page.page.hasNext) {
      if (page.page.nextCursor !== undefined) invalidSessionResponse();
      return sortUserSessions(sessions);
    }

    const nextCursor = page.page.nextCursor;
    if (
      typeof nextCursor !== "string" ||
      !SESSION_CURSOR_PATTERN.test(nextCursor) ||
      cursors.has(nextCursor)
    ) {
      invalidSessionResponse();
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }

  sessionListLimitExceeded();
}

export function sessionListAuthenticationRedirect(
  error: unknown
): string | undefined {
  return error instanceof BrowserApiError && error.status === 401
    ? SESSION_LIST_AUTH_REFRESH_PATH
    : undefined;
}

export function sessionSettingsViewState(input: {
  readonly sessions: readonly UserSessionSummary[] | undefined;
  readonly loading: boolean;
  readonly online: boolean;
  readonly hasLoadError: boolean;
}): SessionSettingsViewState {
  if (!input.sessions) {
    if (input.loading) return "LOADING";
    return input.online ? "ERROR" : "OFFLINE";
  }
  if (!input.online || input.hasLoadError) return "DEGRADED";
  return sessionListHealth(input.sessions);
}

export function parseUserSessions(
  value: readonly unknown[]
): readonly UserSessionSummary[] {
  const sessions = value.map(parseUserSession);
  const ids = new Set<string>();
  let currentCount = 0;
  for (const session of sessions) {
    if (ids.has(session.id)) invalidSessionResponse();
    ids.add(session.id);
    if (session.current) currentCount += 1;
  }
  if (currentCount > 1) invalidSessionResponse();
  return sessions;
}

export function sessionListHealth(
  sessions: readonly UserSessionSummary[]
): SessionListHealth {
  if (sessions.length === 0) return "EMPTY";
  return sessions.some(({ current }) => current)
    ? "READY"
    : "CURRENT_SESSION_MISSING";
}

export function sessionDevicePresentation(
  userAgent: string | undefined
): SessionDevicePresentation {
  if (!userAgent) {
    return {
      title: "Неизвестное устройство",
      browser: "Браузер не определён",
      platform: "Система не определена",
      kind: "unknown",
      monogram: "?"
    };
  }

  const browser = browserName(userAgent);
  const platform = platformName(userAgent);
  const kind = deviceKind(userAgent);
  return {
    title: `${browser} · ${platform}`,
    browser,
    platform,
    kind,
    monogram:
      kind === "mobile" ? "М" : kind === "tablet" ? "ПЛ" : kind === "desktop" ? "ПК" : "?"
  };
}

export function formatSessionActivity(
  value: string,
  now = Date.now()
): string {
  const timestamp = Date.parse(value);
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "только что";
  if (elapsed < 60 * 60_000) {
    return `${Math.floor(elapsed / 60_000)} мин назад`;
  }
  if (elapsed < 24 * 60 * 60_000) {
    return `${Math.floor(elapsed / (60 * 60_000))} ч назад`;
  }
  return formatSessionDate(value);
}

export function formatSessionDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function sessionLocationLabel(): string {
  return "Геопозиция не определена";
}

export function sessionIpLabel(ipAddress: string | undefined): string {
  return ipAddress ? `IP ${ipAddress}` : "IP не определён";
}

export function sessionRevokePath(sessionId: string): string {
  if (!UUID_PATTERN.test(sessionId)) {
    throw new Error("Session id must be a UUID");
  }
  return `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`;
}

function sessionListPath(cursor: string | undefined): string {
  const query = new URLSearchParams({ limit: String(SESSION_PAGE_LIMIT) });
  if (cursor) query.set("cursor", cursor);
  return `${SESSIONS_PATH}?${query.toString()}`;
}

function sortUserSessions(
  sessions: readonly UserSessionSummary[]
): readonly UserSessionSummary[] {
  return [...sessions].sort(
    (left, right) =>
      Number(right.current) - Number(left.current) ||
      Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt) ||
      right.id.localeCompare(left.id)
  );
}

export function sessionRevocationSucceeded(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 404;
}

export function parseRevokedSessionCount(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 1 ||
    !("revoked" in value) ||
    !Number.isSafeInteger(value.revoked) ||
    Number(value.revoked) < 0
  ) {
    invalidSessionResponse();
  }
  return Number(value.revoked);
}

export function withoutRevokedSession(
  sessions: readonly UserSessionSummary[],
  sessionId: string
): readonly UserSessionSummary[] {
  return sessions.filter((session) => session.id !== sessionId);
}

export function withoutOtherSessions(
  sessions: readonly UserSessionSummary[]
): readonly UserSessionSummary[] {
  return sessions.filter(({ current }) => current);
}

export function sessionRequestErrorMessage(
  error: unknown,
  fallback: string
): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "SESSION_LIST_LIMIT_EXCEEDED") {
      return "Активных сессий больше безопасного лимита отображения. Частичный список скрыт; обратитесь в поддержку для проверки аккаунта.";
    }
    if (error.status === 401) {
      return "Сессия завершена. Войдите в аккаунт снова.";
    }
    if (error.status === 403) {
      return "Не удалось подтвердить защищённый запрос. Обновите страницу и повторите попытку.";
    }
    if (error.retryable) {
      return "Сервис сессий временно недоступен. Повторите попытку.";
    }
  }
  return fallback;
}

function parseUserSession(value: unknown): UserSessionSummary {
  const session = plainObject(value);
  assertExactKeys(session);
  if (
    !isUuid(session.id) ||
    typeof session.current !== "boolean" ||
    !isIsoTimestamp(session.authenticatedAt) ||
    !isIsoTimestamp(session.accessExpiresAt) ||
    !isIsoTimestamp(session.expiresAt) ||
    !isIsoTimestamp(session.lastUsedAt) ||
    !isIsoTimestamp(session.createdAt) ||
    !optionalSafeText(
      session.userAgent,
      MAX_USER_AGENT_LENGTH,
      true
    ) ||
    !optionalSafeText(
      session.ipAddress,
      MAX_IP_ADDRESS_LENGTH,
      false
    )
  ) {
    invalidSessionResponse();
  }

  const createdAt = Date.parse(session.createdAt);
  const authenticatedAt = Date.parse(session.authenticatedAt);
  const lastUsedAt = Date.parse(session.lastUsedAt);
  const accessExpiresAt = Date.parse(session.accessExpiresAt);
  const expiresAt = Date.parse(session.expiresAt);
  if (
    lastUsedAt < authenticatedAt ||
    accessExpiresAt <= authenticatedAt ||
    expiresAt <= authenticatedAt ||
    expiresAt <= createdAt
  ) {
    invalidSessionResponse();
  }

  return session as unknown as UserSessionSummary;
}

function plainObject(value: unknown): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalidSessionResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>
): void {
  const allowed = [...REQUIRED_SESSION_KEYS, ...OPTIONAL_SESSION_KEYS];
  const keys = Object.keys(value);
  if (
    REQUIRED_SESSION_KEYS.some((key) => !keys.includes(key)) ||
    keys.some((key) => !allowed.includes(key as (typeof allowed)[number]))
  ) {
    invalidSessionResponse();
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function optionalSafeText(
  value: unknown,
  maxLength: number,
  allowSpaces: boolean
): boolean {
  if (value === undefined) return true;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !CONTROL_OR_BIDI_CHARACTERS.test(value) &&
    (allowSpaces || !/\s/u.test(value))
  );
}

function browserName(userAgent: string): string {
  if (/\bYaBrowser\//u.test(userAgent)) return "Яндекс Браузер";
  if (/\bEdg(?:A|iOS)?\//u.test(userAgent)) return "Microsoft Edge";
  if (/\bOPR\//u.test(userAgent)) return "Opera";
  if (/\bFirefox\//u.test(userAgent) || /\bFxiOS\//u.test(userAgent)) {
    return "Firefox";
  }
  if (/\bCriOS\//u.test(userAgent) || /\bChrome\//u.test(userAgent)) {
    return "Google Chrome";
  }
  if (
    /\bSafari\//u.test(userAgent) &&
    /\bVersion\//u.test(userAgent)
  ) {
    return "Safari";
  }
  return "Неизвестный браузер";
}

function platformName(userAgent: string): string {
  if (/\bWindows NT\b/u.test(userAgent)) return "Windows";
  if (/\bCrOS\b/u.test(userAgent)) return "ChromeOS";
  if (/\bAndroid\b/u.test(userAgent)) return "Android";
  if (/\b(?:iPhone|iPad|iPod)\b/u.test(userAgent)) return "iOS/iPadOS";
  if (/\bMac OS X\b/u.test(userAgent)) return "macOS";
  if (/\bLinux\b/u.test(userAgent)) return "Linux";
  return "Неизвестная система";
}

function deviceKind(userAgent: string): SessionDeviceKind {
  if (/\b(?:iPad|Tablet)\b/u.test(userAgent)) return "tablet";
  if (
    /\bAndroid\b/u.test(userAgent) &&
    !/\bMobile\b/u.test(userAgent)
  ) {
    return "tablet";
  }
  if (/\b(?:Mobile|iPhone|iPod)\b/u.test(userAgent)) return "mobile";
  if (
    /\b(?:Windows NT|Mac OS X|CrOS|Linux)\b/u.test(userAgent)
  ) {
    return "desktop";
  }
  return "unknown";
}

function invalidSessionResponse(): never {
  throw new BrowserApiError(
    502,
    "INVALID_RESPONSE",
    "Сервер вернул некорректный список сессий"
  );
}

function sessionListLimitExceeded(): never {
  throw new BrowserApiError(
    502,
    "SESSION_LIST_LIMIT_EXCEEDED",
    "Active session list exceeded the bounded page limit",
    [],
    undefined,
    false
  );
}
