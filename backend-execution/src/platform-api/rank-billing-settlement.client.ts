import { Inject, Injectable } from "@nestjs/common";
import {
  internalRankExecutionGrantSettlementResult,
  rankExecutionGrantSettlementRequestSchemaVersion,
  type InternalRankExecutionGrantSettlementResultV1
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 64 * 1_024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,180}$/u;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface RankBillingSettlementCommand {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly grantId: string;
}

export interface RankBillingSettlementRequestContext {
  readonly requestId: string;
  readonly idempotencyKey: string;
}

export type RankBillingSettlementClientErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "RESERVATION_EXPIRED"
  | "UNAVAILABLE";

export class RankBillingSettlementClientError extends Error {
  public constructor(
    public readonly code: RankBillingSettlementClientErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "RankBillingSettlementClientError";
  }
}

@Injectable()
export class RankBillingSettlementClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async capture(
    command: RankBillingSettlementCommand,
    context: RankBillingSettlementRequestContext
  ): Promise<InternalRankExecutionGrantSettlementResultV1> {
    return this.settle("CAPTURE", command, context);
  }

  public async hold(
    command: RankBillingSettlementCommand,
    context: RankBillingSettlementRequestContext
  ): Promise<InternalRankExecutionGrantSettlementResultV1> {
    return this.settle("HOLD", command, context);
  }

  private async settle(
    action: "HOLD" | "CAPTURE" | "RELEASE",
    command: RankBillingSettlementCommand,
    context: RankBillingSettlementRequestContext
  ): Promise<InternalRankExecutionGrantSettlementResultV1> {
    validateCommand(command, context);
    const token = this.config.rankBillingSettlementApiToken;
    if (!token) {
      throw new RankBillingSettlementClientError("UNAVAILABLE", false);
    }

    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/internal/v1/workspaces/${encodeURIComponent(command.workspaceId)}/projects/${encodeURIComponent(command.projectId)}/rank-execution-grants/${encodeURIComponent(command.grantId)}/settlements`,
          this.config.services.platformApi
        ),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Rank-Billing-Settlement-Token": token,
            "X-Request-Id": context.requestId,
            "X-Workspace-Id": command.workspaceId,
            "X-Project-Id": command.projectId,
            "X-Actor-Id": command.actorId,
            "Idempotency-Key": context.idempotencyKey
          },
          body: JSON.stringify({
            schemaVersion:
              rankExecutionGrantSettlementRequestSchemaVersion,
            action
          }),
          redirect: "error",
          signal: AbortSignal.timeout(
            Math.min(this.config.platformApiCommandTimeoutMs, 5_000)
          )
        }
      );
    } catch {
      throw new RankBillingSettlementClientError("UNAVAILABLE", true);
    }

    if (retryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new RankBillingSettlementClientError("UNAVAILABLE", true);
    }
    await validateResponseHeaders(response);
    const payload = await boundedJson(response);
    if (response.status === 409) {
      throw new RankBillingSettlementClientError(
        "RESERVATION_EXPIRED",
        false
      );
    }
    if (response.status !== 200) {
      throw new RankBillingSettlementClientError("UNAVAILABLE", false);
    }

    const envelope = exactRecord(payload, ["data", "meta"]);
    const meta = envelope
      ? exactRecord(envelope.meta, ["requestId"])
      : undefined;
    if (!envelope || !meta || meta.requestId !== context.requestId) {
      invalidResponse();
    }
    let result: InternalRankExecutionGrantSettlementResultV1;
    try {
      result = internalRankExecutionGrantSettlementResult(envelope.data);
    } catch {
      invalidResponse();
    }
    if (
      result.grantId !== command.grantId ||
      (action === "CAPTURE"
        ? result.status !== "CAPTURED"
        : action === "RELEASE" ? result.status !== "RELEASED"
        : result.status !== "RESERVED" && result.status !== "CAPTURED")
    ) {
      invalidResponse();
    }
    return result;
  }

  public release(command: RankBillingSettlementCommand, context: RankBillingSettlementRequestContext): Promise<InternalRankExecutionGrantSettlementResultV1> {
    return this.settle("RELEASE", command, context);
  }
}

function validateCommand(
  command: RankBillingSettlementCommand,
  context: RankBillingSettlementRequestContext
): void {
  if (
    !UUID_V7_PATTERN.test(command.workspaceId) ||
    !UUID_V7_PATTERN.test(command.projectId) ||
    !UUID_V7_PATTERN.test(command.actorId) ||
    !UUID_V7_PATTERN.test(command.grantId) ||
    !REQUEST_ID_PATTERN.test(context.requestId) ||
    !IDEMPOTENCY_KEY_PATTERN.test(context.idempotencyKey)
  ) {
    throw new RankBillingSettlementClientError(
      "INVALID_REQUEST",
      false
    );
  }
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
  const contentLength = response.headers.get("content-length");
  if (
    !noStore ||
    contentType !== "application/json" ||
    (contentLength !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
        Number(contentLength) > RESPONSE_MAX_BYTES))
  ) {
    await response.body?.cancel().catch(() => undefined);
    invalidResponse();
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) invalidResponse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_MAX_BYTES) {
        await reader.cancel();
        invalidResponse();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RankBillingSettlementClientError) throw error;
    throw new RankBillingSettlementClientError("UNAVAILABLE", true);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch {
    invalidResponse();
  }
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  return keys.length === fields.length &&
    fields.every((field) => keys.includes(field)) &&
    Object.getOwnPropertyNames(input).length === keys.length &&
    Object.values(descriptors).every(
      (descriptor) =>
        descriptor.enumerable && Object.hasOwn(descriptor, "value")
    )
    ? input
    : undefined;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function invalidResponse(): never {
  throw new RankBillingSettlementClientError(
    "INVALID_RESPONSE",
    false
  );
}
