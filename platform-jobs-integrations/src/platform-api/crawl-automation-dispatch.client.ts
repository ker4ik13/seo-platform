import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalDispatchCrawlAutomationRunInput,
  InternalDispatchCrawlAutomationRunReceipt,
  TechnicalCrawlSummary
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { storedCrawlConfig } from "../crawls/crawl-record.js";
import type { Prisma } from "../generated/prisma/client.js";

const RESPONSE_MAX_BYTES = 64 * 1_024;

export type CrawlAutomationDispatchErrorCode =
  | "AUTHORIZATION_REVOKED"
  | "READ_ONLY_BILLING"
  | "EXECUTION_SCOPE_CONFLICT"
  | "INVALID_RESPONSE"
  | "DEPENDENCY_UNAVAILABLE";

export class CrawlAutomationDispatchError extends Error {
  public constructor(
    public readonly code: CrawlAutomationDispatchErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "CrawlAutomationDispatchError";
  }
}

@Injectable()
export class CrawlAutomationDispatchClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async dispatch(
    input: InternalDispatchCrawlAutomationRunInput
  ): Promise<InternalDispatchCrawlAutomationRunReceipt> {
    const token = this.config.automationDispatchApiToken;
    if (!token) {
      throw new CrawlAutomationDispatchError(
        "DEPENDENCY_UNAVAILABLE",
        false
      );
    }
    const requestId = `crawl-automation-${input.runId}`;
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/internal/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/crawl-automation-runs/dispatch`,
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
            this.config.platformApiCommandTimeoutMs
          )
        }
      );
    } catch {
      throw new CrawlAutomationDispatchError(
        "DEPENDENCY_UNAVAILABLE",
        true
      );
    }

    if (retryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new CrawlAutomationDispatchError(
        "DEPENDENCY_UNAVAILABLE",
        true
      );
    }
    await validateResponseHeaders(response);
    const payload = await boundedJson(response);
    if (response.status !== 201) throw responseError(response.status);

    const envelope = exactRecord(payload, ["data", "meta"]);
    const data = envelope
      ? exactRecord(envelope.data, ["crawl"])
      : undefined;
    const meta = envelope
      ? exactRecord(envelope.meta, ["requestId"])
      : undefined;
    if (!data || !meta || meta.requestId !== requestId) {
      invalidResponse();
    }
    return { crawl: crawlSummary(data.crawl, input) };
  }
}

function crawlSummary(
  value: unknown,
  input: InternalDispatchCrawlAutomationRunInput
): TechnicalCrawlSummary {
  const crawl = exactRecord(value, [
    "id",
    "jobId",
    "workspaceId",
    "projectId",
    "status",
    "config",
    "discoveredUrls",
    "processedUrls",
    "successfulUrls",
    "failedUrls",
    "issueCount",
    "version",
    "createdAt"
  ]);
  if (
    !crawl ||
    !uuid(crawl.id) ||
    !uuid(crawl.jobId) ||
    crawl.workspaceId !== input.workspaceId ||
    crawl.projectId !== input.projectId ||
    crawl.status !== "QUEUED" ||
    !positiveInteger(crawl.version) ||
    !nonNegativeInteger(crawl.discoveredUrls) ||
    !nonNegativeInteger(crawl.processedUrls) ||
    !nonNegativeInteger(crawl.successfulUrls) ||
    !nonNegativeInteger(crawl.failedUrls) ||
    !nonNegativeInteger(crawl.issueCount) ||
    !isoDate(crawl.createdAt)
  ) {
    invalidResponse();
  }
  let config;
  try {
    config = storedCrawlConfig(crawl.config as Prisma.JsonValue);
  } catch {
    return invalidResponse();
  }
  if (JSON.stringify(config) !== JSON.stringify(input.config)) {
    invalidResponse();
  }
  return {
    id: crawl.id as string,
    jobId: crawl.jobId as string,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    status: "QUEUED",
    config,
    discoveredUrls: crawl.discoveredUrls as number,
    processedUrls: crawl.processedUrls as number,
    successfulUrls: crawl.successfulUrls as number,
    failedUrls: crawl.failedUrls as number,
    issueCount: crawl.issueCount as number,
    version: crawl.version as number,
    createdAt: crawl.createdAt as string
  };
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
    if (error instanceof CrawlAutomationDispatchError) throw error;
    throw new CrawlAutomationDispatchError(
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

function responseError(status: number): CrawlAutomationDispatchError {
  if (status === 401 || status === 403 || status === 404) {
    return new CrawlAutomationDispatchError(
      "AUTHORIZATION_REVOKED",
      false
    );
  }
  if (status === 402) {
    return new CrawlAutomationDispatchError("READ_ONLY_BILLING", false);
  }
  if (status === 409 || status === 412) {
    return new CrawlAutomationDispatchError(
      "EXECUTION_SCOPE_CONFLICT",
      false
    );
  }
  return new CrawlAutomationDispatchError(
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

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function invalidResponse(): never {
  throw new CrawlAutomationDispatchError("INVALID_RESPONSE", false);
}
