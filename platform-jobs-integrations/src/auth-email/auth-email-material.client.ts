import { Inject, Injectable } from "@nestjs/common";
import {
  AUTH_EMAIL_COMPLETION_SCHEMA,
  internalAuthEmailCompletion,
  internalAuthEmailCompletionReceipt,
  internalAuthEmailMaterialDecision,
  type InternalAuthEmailCompletionReceiptV1,
  type InternalAuthEmailCompletionOutcomeV1,
  type InternalAuthEmailMaterialDecisionV1,
  type TransactionalEmailEventTypeV1
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 16 * 1_024;

export type AuthEmailMaterialClientErrorCode =
  | "PLATFORM_AUTH_FAILED"
  | "PLATFORM_INVALID_RESPONSE"
  | "PLATFORM_REJECTED"
  | "PLATFORM_UNAVAILABLE";

export class AuthEmailMaterialClientError extends Error {
  public constructor(
    public readonly code: AuthEmailMaterialClientErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "AuthEmailMaterialClientError";
  }
}

@Injectable()
export class AuthEmailMaterialClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async material(
    eventId: string,
    expectedEventType: TransactionalEmailEventTypeV1
  ): Promise<InternalAuthEmailMaterialDecisionV1> {
    const requestId = `auth-email-material-${eventId}`;
    const payload = await this.request(
      eventId,
      "material",
      requestId,
      {}
    );
    let decision: InternalAuthEmailMaterialDecisionV1;
    try {
      decision = internalAuthEmailMaterialDecision(payload);
    } catch {
      throw invalidResponse();
    }
    if (
      decision.eventId !== eventId ||
      ((decision.decision === "READY" ||
        decision.decision === "READY_RECEIPT") &&
        decision.eventType !== expectedEventType)
    ) {
      throw invalidResponse();
    }
    return decision;
  }

  public async complete(
    eventId: string,
    outcome: InternalAuthEmailCompletionOutcomeV1 = "DELIVERED"
  ): Promise<InternalAuthEmailCompletionReceiptV1> {
    const requestId = `auth-email-complete-${eventId}`;
    const completion = internalAuthEmailCompletion({
      schemaVersion: AUTH_EMAIL_COMPLETION_SCHEMA,
      eventId,
      outcome
    });
    const payload = await this.request(
      eventId,
      "complete",
      requestId,
      completion
    );
    let receipt: InternalAuthEmailCompletionReceiptV1;
    try {
      receipt = internalAuthEmailCompletionReceipt(payload);
    } catch {
      throw invalidResponse();
    }
    if (receipt.eventId !== eventId || receipt.outcome !== outcome) {
      throw invalidResponse();
    }
    return receipt;
  }

  private async request(
    eventId: string,
    operation: "material" | "complete",
    requestId: string,
    body: unknown
  ): Promise<unknown> {
    const token = this.config.authEmailApiToken;
    if (!token) {
      throw new AuthEmailMaterialClientError(
        "PLATFORM_AUTH_FAILED",
        false
      );
    }
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/internal/v1/auth-email-deliveries/${encodeURIComponent(eventId)}/${operation}`,
          this.config.services.platformApi
        ),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Request-Id": requestId
          },
          body: JSON.stringify(body),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(
            this.config.platformApiCommandTimeoutMs
          )
        }
      );
    } catch {
      throw new AuthEmailMaterialClientError(
        "PLATFORM_UNAVAILABLE",
        true
      );
    }

    if (retryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new AuthEmailMaterialClientError(
        "PLATFORM_UNAVAILABLE",
        true
      );
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new AuthEmailMaterialClientError(
        "PLATFORM_AUTH_FAILED",
        false
      );
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new AuthEmailMaterialClientError(
        "PLATFORM_REJECTED",
        false
      );
    }

    await validateResponseHeaders(response);
    const envelope = exactResponseEnvelope(
      await boundedJson(response, RESPONSE_MAX_BYTES)
    );
    if (envelope.meta.requestId !== requestId) throw invalidResponse();
    return envelope.data;
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function invalidResponse(): AuthEmailMaterialClientError {
  return new AuthEmailMaterialClientError(
    "PLATFORM_INVALID_RESPONSE",
    false
  );
}

async function validateResponseHeaders(response: Response): Promise<void> {
  const noStore = response.headers
    .get("cache-control")
    ?.split(",")
    .some((directive) => directive.trim().toLowerCase() === "no-store");
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const declaredLength = response.headers.get("content-length");
  if (
    !noStore ||
    contentType !== "application/json" ||
    (declaredLength !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(declaredLength) ||
        Number(declaredLength) > RESPONSE_MAX_BYTES))
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidResponse();
  }
}

async function boundedJson(
  response: Response,
  maximumBytes: number
): Promise<unknown> {
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw invalidResponse();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AuthEmailMaterialClientError) throw error;
    throw new AuthEmailMaterialClientError(
      "PLATFORM_UNAVAILABLE",
      true
    );
  }

  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(data)
    );
  } catch {
    throw invalidResponse();
  }
}

function exactResponseEnvelope(value: unknown): {
  readonly data: unknown;
  readonly meta: { readonly requestId: string };
} {
  const envelope = exactRecord(value, ["data", "meta"]);
  const meta = exactRecord(envelope.meta, ["requestId"]);
  if (typeof meta.requestId !== "string") throw invalidResponse();
  return { data: envelope.data, meta: { requestId: meta.requestId } };
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw invalidResponse();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(descriptors).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(descriptors, field)) ||
    Object.values(descriptors).some(
      (descriptor) =>
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
    )
  ) {
    throw invalidResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}
