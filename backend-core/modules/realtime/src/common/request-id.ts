import { randomUUID } from "node:crypto";

const SAFE_REQUEST_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

interface RequestWithHeaders {
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
}

export function safeRequestId(request: RequestWithHeaders): string {
  const candidate = request.headers["x-request-id"];
  return typeof candidate === "string" &&
    SAFE_REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
}
