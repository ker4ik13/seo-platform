import type { ProviderFetch } from "./integration-credential-validation.connector.js";

const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;
const MAX_PROVIDER_RETRY_AFTER_SECONDS = 3_600;

export interface ProviderJsonResponse {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly value: unknown;
}

export interface ProviderTextResponse {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly value: string;
}

export async function providerTextRequest(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  fetcher: ProviderFetch = fetch,
  now: () => number = Date.now,
  maximumResponseBytes = MAX_PROVIDER_RESPONSE_BYTES
): Promise<ProviderTextResponse> {
  if (
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1 ||
    maximumResponseBytes > MAX_PROVIDER_RESPONSE_BYTES_HARD_LIMIT
  ) {
    throw new TypeError("Invalid provider response byte limit");
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new ProviderTransportError();
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumResponseBytes
  ) {
    throw new ProviderTransportError();
  }
  const value = await boundedResponseText(response, maximumResponseBytes);
  if (response.ok && value.trim().length === 0) {
    throw new ProviderTransportError();
  }
  const retryAfterSeconds = retryAfter(
    response.headers.get("retry-after"),
    now()
  );
  return {
    status: response.status,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    value
  };
}

export async function providerJsonRequest(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  fetcher: ProviderFetch = fetch,
  now: () => number = Date.now,
  maximumResponseBytes = MAX_PROVIDER_RESPONSE_BYTES
): Promise<ProviderJsonResponse> {
  if (
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1 ||
    maximumResponseBytes > MAX_PROVIDER_RESPONSE_BYTES_HARD_LIMIT
  ) {
    throw new TypeError("Invalid provider response byte limit");
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new ProviderTransportError();
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumResponseBytes
  ) {
    throw new ProviderTransportError();
  }

  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const jsonResponse =
    mediaType === "application/json" || mediaType?.endsWith("+json") === true;
  const successful = response.status >= 200 && response.status < 300;
  if (successful && !jsonResponse) {
    throw new ProviderTransportError();
  }

  const body = await boundedResponseText(response, maximumResponseBytes);
  let value: unknown = undefined;
  if (jsonResponse && body.trim().length > 0) {
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      if (successful) throw new ProviderTransportError();
    }
  } else if (successful) {
    throw new ProviderTransportError();
  }

  const retryAfterSeconds = retryAfter(
    response.headers.get("retry-after"),
    now()
  );
  return {
    status: response.status,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    value
  };
}

export class ProviderTransportError extends Error {
  public constructor() {
    super("Provider request failed");
    this.name = "ProviderTransportError";
  }
}

function retryAfter(
  value: string | null,
  now: number
): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    if (normalized.length > 10) {
      return MAX_PROVIDER_RETRY_AFTER_SECONDS;
    }
    const seconds = Number(normalized);
    return Number.isSafeInteger(seconds)
      ? Math.min(seconds, MAX_PROVIDER_RETRY_AFTER_SECONDS)
      : undefined;
  }
  if (!HTTP_DATE_PATTERN.test(normalized)) return undefined;
  const retryAt = Date.parse(normalized);
  if (
    !Number.isFinite(retryAt) ||
    new Date(retryAt).toUTCString() !== normalized
  ) {
    return undefined;
  }
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1_000));
  return Math.min(seconds, MAX_PROVIDER_RETRY_AFTER_SECONDS);
}

async function boundedResponseText(
  response: Response,
  maximumResponseBytes: number
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumResponseBytes) {
        await reader.cancel();
        throw new ProviderTransportError();
      }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    throw new ProviderTransportError();
  } finally {
    reader.releaseLock();
  }
}

const MAX_PROVIDER_RESPONSE_BYTES_HARD_LIMIT = 128 * 1_048_576;

const HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u;
