import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalDispatchRankAutomationRunInput,
  InternalDispatchRankAutomationRunReceipt
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 16 * 1_024;

export type RankAutomationDispatchErrorCode =
  | "AUTHORIZATION_REVOKED"
  | "READ_ONLY_BILLING"
  | "EXECUTION_SCOPE_CONFLICT"
  | "INVALID_RESPONSE"
  | "DEPENDENCY_UNAVAILABLE";

export class RankAutomationDispatchError extends Error {
  public constructor(
    public readonly code: RankAutomationDispatchErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "RankAutomationDispatchError";
  }
}

@Injectable()
export class RankAutomationDispatchClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async dispatch(
    input: InternalDispatchRankAutomationRunInput
  ): Promise<InternalDispatchRankAutomationRunReceipt> {
    const token = this.config.automationDispatchApiToken;
    if (!token) {
      throw new RankAutomationDispatchError(
        "DEPENDENCY_UNAVAILABLE",
        false
      );
    }
    const requestId = `rank-automation-${input.runId}`;
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/internal/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/rank-automation-runs/dispatch`,
          this.config.services.platformApi
        ),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Automation-Token": token,
            "X-Request-Id": requestId,
            "X-Workspace-Id": input.workspaceId,
            "X-Project-Id": input.projectId,
            "X-Actor-Id": input.actorId,
            "Idempotency-Key": input.idempotencyKey
          },
          body: JSON.stringify(input),
          redirect: "error",
          signal: AbortSignal.timeout(
            Math.max(
              this.config.platformApiCommandTimeoutMs,
              this.config.internalCommandTimeoutMs * 2
            )
          )
        }
      );
    } catch {
      throw new RankAutomationDispatchError(
        "DEPENDENCY_UNAVAILABLE",
        true
      );
    }

    if (retryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new RankAutomationDispatchError(
        "DEPENDENCY_UNAVAILABLE",
        true
      );
    }
    await validateResponseHeaders(response);
    const payload = await boundedJson(response);
    if (response.status !== 201) throw responseError(response.status);

    const envelope = exactRecord(payload, ["data", "meta"]);
    const data = envelope
      ? exactRecord(envelope.data, ["estimateId", "jobId"])
      : undefined;
    const meta = envelope
      ? exactRecord(envelope.meta, ["requestId"])
      : undefined;
    if (
      !data ||
      !meta ||
      meta.requestId !== requestId ||
      !uuid(data.estimateId) ||
      !uuid(data.jobId)
    ) {
      invalidResponse();
    }
    return { estimateId: data.estimateId, jobId: data.jobId };
  }
}

async function validateResponseHeaders(response: Response): Promise<void> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const noStore = response.headers
    .get("cache-control")
    ?.split(",")
    .some((value) => value.trim().toLowerCase() === "no-store");
  const length = response.headers.get("content-length");
  if (
    contentType !== "application/json" ||
    !noStore ||
    (length !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(length) ||
        Number(length) > RESPONSE_MAX_BYTES))
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
    if (error instanceof RankAutomationDispatchError) throw error;
    throw new RankAutomationDispatchError(
      "DEPENDENCY_UNAVAILABLE",
      true
    );
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return invalidResponse();
  }
}

function responseError(status: number): RankAutomationDispatchError {
  if (status === 401 || status === 403 || status === 404) {
    return new RankAutomationDispatchError(
      "AUTHORIZATION_REVOKED",
      false
    );
  }
  if (status === 402) {
    return new RankAutomationDispatchError("READ_ONLY_BILLING", false);
  }
  if (status === 409 || status === 412) {
    return new RankAutomationDispatchError(
      "EXECUTION_SCOPE_CONFLICT",
      false
    );
  }
  return new RankAutomationDispatchError(
    "DEPENDENCY_UNAVAILABLE",
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
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input);
  return keys.length === fields.length &&
    fields.every((field) => keys.includes(field))
    ? input
    : undefined;
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  );
}

function invalidResponse(): never {
  throw new RankAutomationDispatchError("INVALID_RESPONSE", false);
}
