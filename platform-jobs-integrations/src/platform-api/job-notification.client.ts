import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalDeliverJobNotificationInput,
  InternalDeliverJobNotificationReceipt
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 64 * 1_024;

export class JobNotificationDeliveryError extends Error {
  public constructor(
    public readonly retryable: boolean,
    code: "AUTHORIZATION_REVOKED" | "INVALID_RESPONSE" | "DEPENDENCY_UNAVAILABLE"
  ) {
    super(code);
    this.name = "JobNotificationDeliveryError";
  }
}

@Injectable()
export class JobNotificationClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async deliver(
    input: InternalDeliverJobNotificationInput
  ): Promise<InternalDeliverJobNotificationReceipt> {
    const token = this.config.automationDispatchApiToken;
    if (!token) {
      throw new JobNotificationDeliveryError(false, "DEPENDENCY_UNAVAILABLE");
    }
    const requestId = `job-notification-${input.jobId}-${input.status.toLowerCase()}`;
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/internal/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/jobs/${encodeURIComponent(input.jobId)}/notification`,
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
          signal: AbortSignal.timeout(this.config.platformApiCommandTimeoutMs)
        }
      );
    } catch {
      throw unavailable(true);
    }
    if (retryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw unavailable(true);
    }
    await validateHeaders(response);
    const payload = await boundedJson(response);
    if (response.status !== 200) {
      if ([401, 403, 404, 409].includes(response.status)) {
        throw new JobNotificationDeliveryError(false, "AUTHORIZATION_REVOKED");
      }
      throw unavailable(false);
    }
    const envelope = exactRecord(payload, ["data", "meta"]);
    const data = envelope
      ? exactRecord(envelope.data, ["accepted", "outcome"])
      : undefined;
    const meta = envelope
      ? exactRecord(envelope.meta, ["requestId"])
      : undefined;
    if (
      !data ||
      !meta ||
      data.accepted !== true ||
      !["CREATED", "EXISTING", "SKIPPED"].includes(String(data.outcome)) ||
      meta.requestId !== requestId
    ) {
      throw invalidResponse();
    }
    return {
      accepted: true,
      outcome: data.outcome as InternalDeliverJobNotificationReceipt["outcome"]
    };
  }
}

async function validateHeaders(response: Response): Promise<void> {
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
      (!/^(?:0|[1-9]\d*)$/u.test(length) || Number(length) > RESPONSE_MAX_BYTES))
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidResponse();
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw invalidResponse();
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
        throw invalidResponse();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof JobNotificationDeliveryError) throw error;
    throw unavailable(true);
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
    throw invalidResponse();
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
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field))
  ) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function invalidResponse(): JobNotificationDeliveryError {
  return new JobNotificationDeliveryError(false, "INVALID_RESPONSE");
}

function unavailable(retryable: boolean): JobNotificationDeliveryError {
  return new JobNotificationDeliveryError(retryable, "DEPENDENCY_UNAVAILABLE");
}
