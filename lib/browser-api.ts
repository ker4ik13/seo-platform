export interface BrowserFieldError {
  readonly path: string;
  readonly code: string;
  readonly message?: string;
}

export class BrowserApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: readonly BrowserFieldError[] = []
  ) {
    super(message);
    this.name = "BrowserApiError";
  }
}

export async function browserApiRequest<Data>(
  path: string,
  options: {
    readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
    readonly body?: unknown;
    readonly ifMatch?: number;
    readonly idempotencyKey?: string;
  } = {}
): Promise<Data> {
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

  const response = await fetch(path, {
    method,
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
    credentials: "same-origin",
    cache: "no-store"
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw browserApiError(response.status, payload);
  if (response.status === 204) return undefined as Data;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload)
  ) {
    throw new BrowserApiError(
      502,
      "INVALID_RESPONSE",
      "Сервер вернул некорректный ответ"
    );
  }
  return payload.data as Data;
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

function browserApiError(status: number, payload: unknown): BrowserApiError {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null
  ) {
    const error = payload.error as Readonly<Record<string, unknown>>;
    return new BrowserApiError(
      status,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error.message === "string"
        ? error.message
        : "Не удалось выполнить запрос",
      Array.isArray(error.fieldErrors)
        ? error.fieldErrors.filter(isFieldError)
        : []
    );
  }
  return new BrowserApiError(
    status,
    "REQUEST_FAILED",
    status >= 500
      ? "Сервис временно недоступен"
      : "Не удалось выполнить запрос"
  );
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
