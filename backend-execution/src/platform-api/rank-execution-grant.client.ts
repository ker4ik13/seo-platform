import { Inject, Injectable } from "@nestjs/common";
import {
  internalIssueRankExecutionGrantInput,
  internalRankExecutionGrantDecision,
  rankExecutionGrantRequestHashDomain,
  rankExecutionGrantRequestHashPreimage,
  rankExecutionGrantScopeHashDomain,
  rankExecutionGrantScopeHashPreimage,
  type InternalIssueRankExecutionGrantInputV1,
  type InternalRankExecutionGrantDecisionV1,
  type RankManifestHash
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 64 * 1_024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,180}$/u;

export interface RankExecutionGrantRequestContext {
  readonly requestId: string;
  readonly idempotencyKey: string;
}

export type RankExecutionGrantClientErrorCode =
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE";

export class RankExecutionGrantClientError extends Error {
  public constructor(
    public readonly code: RankExecutionGrantClientErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "RankExecutionGrantClientError";
  }
}

@Injectable()
export class RankExecutionGrantClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async issue(
    value: InternalIssueRankExecutionGrantInputV1,
    context: RankExecutionGrantRequestContext
  ): Promise<InternalRankExecutionGrantDecisionV1> {
    const input = requestInput(value);
    validateRequestContext(context);
    const token = this.config.rankGrantApiToken;
    if (!token) {
      throw new RankExecutionGrantClientError("UNAVAILABLE", false);
    }

    const expectedRequestHash = contractHash(
      rankExecutionGrantRequestHashDomain,
      rankExecutionGrantRequestHashPreimage(input)
    );
    const expectedScopeHash = contractHash(
      rankExecutionGrantScopeHashDomain,
      rankExecutionGrantScopeHashPreimage(input)
    );
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/internal/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/rank-execution-grants`,
          this.config.services.platformApi
        ),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Rank-Grant-Token": token,
            "X-Request-Id": context.requestId,
            "X-Workspace-Id": input.workspaceId,
            "X-Project-Id": input.projectId,
            "X-Actor-Id": input.actorId,
            "Idempotency-Key": context.idempotencyKey
          },
          body: JSON.stringify(input),
          redirect: "error",
          signal: AbortSignal.timeout(
            this.config.platformApiCommandTimeoutMs
          )
        }
      );
    } catch {
      throw new RankExecutionGrantClientError("UNAVAILABLE", true);
    }

    if (retryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new RankExecutionGrantClientError("UNAVAILABLE", true);
    }
    await validateResponseHeaders(response);
    const payload = await boundedJson(response, RESPONSE_MAX_BYTES);
    if (response.status !== 200 && response.status !== 201) {
      throw responseError(response.status);
    }

    const envelope = exactRecord(payload, ["data", "meta"]);
    const meta = envelope
      ? exactRecord(envelope.meta, ["requestId"])
      : undefined;
    if (!envelope || !meta || meta.requestId !== context.requestId) {
      throw new RankExecutionGrantClientError("INVALID_RESPONSE", false);
    }

    let decision: InternalRankExecutionGrantDecisionV1;
    try {
      decision = internalRankExecutionGrantDecision(envelope.data);
    } catch {
      throw new RankExecutionGrantClientError("INVALID_RESPONSE", false);
    }
    if (!hashEqual(decision.requestHash, expectedRequestHash)) {
      throw new RankExecutionGrantClientError("INVALID_RESPONSE", false);
    }
    if (
      decision.status === "GRANTED" &&
      !hashEqual(decision.grant.scopeHash, expectedScopeHash)
    ) {
      throw new RankExecutionGrantClientError("INVALID_RESPONSE", false);
    }
    return decision;
  }
}

function requestInput(
  value: InternalIssueRankExecutionGrantInputV1
): InternalIssueRankExecutionGrantInputV1 {
  try {
    return internalIssueRankExecutionGrantInput(value);
  } catch {
    throw new RankExecutionGrantClientError("INVALID_REQUEST", false);
  }
}

function validateRequestContext(
  context: RankExecutionGrantRequestContext
): void {
  if (
    !REQUEST_ID_PATTERN.test(context.requestId) ||
    !IDEMPOTENCY_KEY_PATTERN.test(context.idempotencyKey)
  ) {
    throw new RankExecutionGrantClientError("INVALID_REQUEST", false);
  }
}

function contractHash(domain: string, value: unknown): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(domain, value)
  };
}

function hashEqual(left: RankManifestHash, right: RankManifestHash): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

async function validateResponseHeaders(response: Response): Promise<void> {
  const cacheControl = response.headers.get("cache-control");
  const noStore = cacheControl
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
    throw new RankExecutionGrantClientError("INVALID_RESPONSE", false);
  }
}

async function boundedJson(
  response: Response,
  maximumBytes: number
): Promise<unknown> {
  if (!response.body) {
    throw new RankExecutionGrantClientError("INVALID_RESPONSE", false);
  }
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
        throw new RankExecutionGrantClientError(
          "INVALID_RESPONSE",
          false
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RankExecutionGrantClientError) throw error;
    throw new RankExecutionGrantClientError("UNAVAILABLE", true);
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
    throw new RankExecutionGrantClientError("INVALID_RESPONSE", false);
  }
}

function responseError(status: number): RankExecutionGrantClientError {
  if (status === 409) {
    return new RankExecutionGrantClientError(
      "IDEMPOTENCY_CONFLICT",
      false
    );
  }
  return new RankExecutionGrantClientError(
    "UNAVAILABLE",
    retryableStatus(status)
  );
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
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
