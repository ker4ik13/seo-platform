import {
  coordinatedBrowserSessionRefresh,
  type BrowserSessionRefreshLockManager
} from "./session-refresh-coordination.ts";

export type AdminApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code?: string;
      readonly message: string;
    };

export async function adminApi<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<AdminApiResult<T>> {
  try {
    const request: RequestInit = {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers
      },
      credentials: "same-origin",
      cache: "no-store"
    };
    const response = await adminSessionAwareFetch(`/admin${path}`, request);
    const payload = (await response.json().catch(() => ({}))) as {
      readonly data?: T;
      readonly error?: { readonly code?: string; readonly message?: string };
    };
    if (response.ok && payload.data !== undefined) {
      return { ok: true, data: payload.data };
    }
    return {
      ok: false,
      status: response.status,
      ...(payload.error?.code ? { code: payload.error.code } : {}),
      message: payload.error?.message ?? `Ошибка HTTP ${response.status}`
    };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "API администрирования недоступен"
    };
  }
}

export function adminApiCollection<T>(
  path: string
): Promise<AdminApiResult<readonly T[]>> {
  return adminApi<readonly T[]>(path);
}

let adminSessionRefreshPromise: Promise<boolean> | undefined;

async function adminSessionAwareFetch(
  path: string,
  request: RequestInit
): Promise<Response> {
  const observedCsrf = browserCookie(csrfCookieName());
  const response = await fetch(path, request);
  if (
    response.status !== 401 ||
    !observedCsrf ||
    request.signal?.aborted
  ) {
    return response;
  }

  const refreshed = await refreshAdminSession(observedCsrf);
  if (!refreshed || request.signal?.aborted) return response;

  const headers = new Headers(request.headers);
  if ((request.method ?? "GET").toUpperCase() !== "GET") {
    const csrf = browserCookie(csrfCookieName());
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  return fetch(path, { ...request, headers });
}

async function refreshAdminSession(observedCsrf: string): Promise<boolean> {
  adminSessionRefreshPromise ??= coordinatedBrowserSessionRefresh(
    observedCsrf,
    () => browserCookie(csrfCookieName()),
    performAdminSessionRefresh,
    browserSessionLockManager()
  ).finally(() => {
    adminSessionRefreshPromise = undefined;
  });
  return adminSessionRefreshPromise;
}

async function performAdminSessionRefresh(csrf: string): Promise<boolean> {
  const response = await fetch("/admin/api/auth/refresh", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrf
    },
    credentials: "same-origin",
    cache: "no-store"
  }).catch(() => undefined);
  return response?.ok === true;
}

function browserSessionLockManager(): BrowserSessionRefreshLockManager | undefined {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.locks?.request !== "function"
  ) {
    return undefined;
  }
  return navigator.locks as unknown as BrowserSessionRefreshLockManager;
}

function csrfCookieName(): string {
  return process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME ?? "seo_csrf";
}

function browserCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : undefined;
}
