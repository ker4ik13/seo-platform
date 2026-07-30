import { BadRequestException } from "@nestjs/common";
import {
  internalAuthEmailCompletion,
  type InternalAuthEmailCompletionV1
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

export interface AuthEmailHeaderRequest {
  readonly id?: string;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly raw?: { readonly rawHeaders?: readonly string[] };
}

export function authEmailCompletionInput(
  value: unknown
): InternalAuthEmailCompletionV1 {
  try {
    return internalAuthEmailCompletion(value);
  } catch {
    throw new BadRequestException("Invalid auth-email completion request");
  }
}

export function authEmailEventId(value: string): string {
  const eventId = assertUuid(value, "eventId");
  if (eventId[14] !== "7") {
    throw new BadRequestException(
      "A canonical auth-email event UUIDv7 is required"
    );
  }
  return eventId;
}

export function emptyAuthEmailMaterialInput(value: unknown): void {
  if (value === undefined) return;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== 0
  ) {
    throw new BadRequestException("Auth-email material body must be empty");
  }
}

export function requiredAuthEmailRequestId(
  request: AuthEmailHeaderRequest
): string {
  const value = authEmailSingleHeader(request, "x-request-id");
  if (!value || !REQUEST_ID_PATTERN.test(value) || request.id !== value) {
    throw new BadRequestException(
      "A single bounded X-Request-Id header matching the request is required"
    );
  }
  return value;
}

/** Reads one exact header and rejects raw duplicates when available. */
export function authEmailSingleHeader(
  request: AuthEmailHeaderRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  if (typeof value !== "string") return undefined;
  const rawHeaders = request.raw?.rawHeaders;
  if (rawHeaders !== undefined) {
    if (rawHeaders.length % 2 !== 0) return undefined;
    let matches = 0;
    let rawValue: string | undefined;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === name) {
        matches += 1;
        rawValue = rawHeaders[index + 1];
      }
    }
    if (matches !== 1 || rawValue !== value) return undefined;
  }
  return value;
}

export function authEmailBearerToken(
  request: AuthEmailHeaderRequest
): string | undefined {
  const authorization = authEmailSingleHeader(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length);
  if (!token || /\s/u.test(token)) return undefined;
  return token;
}
