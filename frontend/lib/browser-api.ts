import {
  rankRunConflictDetails,
  type RankRunConflictDetails
} from "@seo-platform/contracts";
import { announceSemanticMutationForRequest } from "./semantic-realtime.ts";

export interface BrowserFieldError {
  readonly path: string;
  readonly code: string;
  readonly message?: string;
}

export class BrowserApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly fieldErrors: readonly BrowserFieldError[];
  public readonly requestId: string | undefined;
  public readonly retryable: boolean;
  public readonly conflictDetails: RankRunConflictDetails | undefined;
  public readonly reason: RankRunConflictDetails["reason"] | undefined;
  public readonly existingJobId: string | undefined;

  public constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: readonly BrowserFieldError[] = [],
    requestId?: string,
    retryable = status >= 500,
    conflictDetails?: RankRunConflictDetails
  ) {
    super(message);
    this.name = "BrowserApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.requestId = requestId;
    this.retryable = retryable;
    this.conflictDetails = conflictDetails;
    this.reason = conflictDetails?.reason;
    this.existingJobId =
      conflictDetails?.reason === "EQUIVALENT_RUN_ACTIVE"
        ? conflictDetails.existingJobId
        : undefined;
  }
}

export interface BrowserCursorPage {
  readonly nextCursor?: string;
  readonly hasNext: boolean;
  readonly totalApprox?: number;
  readonly unreadCount?: number;
}

export interface BrowserApiCollection<Data> {
  readonly data: readonly Data[];
  readonly page: BrowserCursorPage;
}

interface BrowserApiOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly ifMatch?: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

let sessionRefreshPromise: Promise<boolean> | undefined;

export async function browserApiRequest<Data>(
  path: string,
  options: BrowserApiOptions = {}
): Promise<Data> {
  const { response, payload } = await browserApiPayload(path, options);
  if (response.status === 204) return undefined as Data;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload)
  ) {
    throw invalidResponse();
  }
  return payload.data as Data;
}

export async function browserApiCollectionRequest<Data>(
  path: string,
  options: BrowserApiOptions = {}
): Promise<BrowserApiCollection<Data>> {
  const { payload } = await browserApiPayload(path, options);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray(payload.data) ||
    !("page" in payload) ||
    typeof payload.page !== "object" ||
    payload.page === null
  ) {
    throw invalidResponse();
  }
  const page = payload.page as Readonly<Record<string, unknown>>;
  if (
    typeof page.hasNext !== "boolean" ||
    (page.nextCursor !== undefined &&
      typeof page.nextCursor !== "string") ||
    (page.totalApprox !== undefined &&
      (!Number.isSafeInteger(page.totalApprox) ||
        Number(page.totalApprox) < 0)) ||
    (page.unreadCount !== undefined &&
      (!Number.isSafeInteger(page.unreadCount) ||
        Number(page.unreadCount) < 0))
  ) {
    throw invalidResponse();
  }
  return {
    data: payload.data as Data[],
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {}),
      ...(typeof page.totalApprox === "number"
        ? { totalApprox: page.totalApprox }
        : {}),
      ...(typeof page.unreadCount === "number"
        ? { unreadCount: page.unreadCount }
        : {})
    }
  };
}

async function browserApiPayload(
  path: string,
  options: BrowserApiOptions
): Promise<{ readonly response: Response; readonly payload: unknown }> {
  if (!path.startsWith("/app/api/")) {
    throw new Error("Browser API path must use the same-origin BFF");
  }

  const method = options.method ?? "GET";
  const headers = new Headers({
    Accept: "application/json"
  });
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.ifMatch !== undefined) {
    headers.set("If-Match", `"v${options.ifMatch}"`);
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  if (method !== "GET") {
    const csrf = browserCookie(
      process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME ?? "seo_csrf"
    );
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const response = await sessionAwareFetch(path, {
    method,
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
    credentials: "same-origin",
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {})
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw browserApiError(
      response.status,
      payload,
      response.headers.get("x-request-id") ?? undefined
    );
  }
  announceSemanticMutationForRequest(path, method);
  return { response, payload };
}

async function sessionAwareFetch(
  path: string,
  request: RequestInit
): Promise<Response> {
  const response = await fetch(path, request);
  if (
    response.status !== 401 ||
    !browserCookie(csrfCookieName()) ||
    request.signal?.aborted
  ) {
    return response;
  }

  const refreshed = await refreshBrowserSession();
  if (!refreshed || request.signal?.aborted) return response;

  const headers = new Headers(request.headers);
  if ((request.method ?? "GET") !== "GET") {
    const csrf = browserCookie(csrfCookieName());
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  return fetch(path, { ...request, headers });
}

async function refreshBrowserSession(): Promise<boolean> {
  sessionRefreshPromise ??= performSessionRefresh().finally(() => {
    sessionRefreshPromise = undefined;
  });
  return sessionRefreshPromise;
}

async function performSessionRefresh(): Promise<boolean> {
  const csrf = browserCookie(csrfCookieName());
  if (!csrf) return false;
  const response = await fetch("/app/auth/refresh", {
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

function csrfCookieName(): string {
  return process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME ?? "seo_csrf";
}

function invalidResponse(): BrowserApiError {
  return new BrowserApiError(
    502,
    "INVALID_RESPONSE",
    "Сервер вернул некорректный ответ"
  );
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

function browserApiError(
  status: number,
  payload: unknown,
  responseRequestId?: string
): BrowserApiError {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null
  ) {
    const error = payload.error as Readonly<Record<string, unknown>>;
    const requestId =
      typeof error.requestId === "string"
        ? error.requestId
        : responseRequestId;
    return new BrowserApiError(
      status,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      status === 401
        ? "Сессия завершена. Войдите в аккаунт ещё раз."
        : typeof error.message === "string"
          ? error.message
          : "Не удалось выполнить запрос",
      Array.isArray(error.fieldErrors)
        ? error.fieldErrors.filter(isFieldError)
        : [],
      requestId,
      typeof error.retryable === "boolean"
        ? error.retryable
        : status >= 500,
      browserApiRankRunConflictDetails(error.details)
    );
  }
  return new BrowserApiError(
    status,
    "REQUEST_FAILED",
    status >= 500
      ? "Сервис временно недоступен"
      : "Не удалось выполнить запрос",
    [],
    responseRequestId,
    status >= 500
  );
}

function browserApiRankRunConflictDetails(
  value: unknown
): RankRunConflictDetails | undefined {
  try {
    return rankRunConflictDetails(value);
  } catch {
    return undefined;
  }
}

function isFieldError(value: unknown): value is BrowserFieldError {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "code" in value &&
    typeof value.code === "string"
  );
}
