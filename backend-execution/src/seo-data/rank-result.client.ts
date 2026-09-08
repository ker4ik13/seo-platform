import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalIngestRankChunkInput,
  InternalRankChunkIngestReceipt
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 64 * 1_024;

export type RankResultClientErrorCode =
  | "INVALID_COMMAND"
  | "CONFLICT"
  | "UNAVAILABLE";

export class RankResultClientError extends Error {
  public constructor(
    public readonly code: RankResultClientErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "RankResultClientError";
  }
}

@Injectable()
export class RankResultClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async ingest(
    input: InternalIngestRankChunkInput
  ): Promise<InternalRankChunkIngestReceipt> {
    const token = this.config.rankResultApiToken;
    if (!token) throw new RankResultClientError("UNAVAILABLE", true);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/rank-manifests/${encodeURIComponent(input.manifestId)}/chunks/${input.chunkIndex}/results`,
      this.config.services.seoData
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Rank-Result-Token": token,
          "X-Workspace-Id": input.workspaceId,
          "X-Project-Id": input.projectId,
          "X-Actor-Id": input.actorId
        },
        body: JSON.stringify(input),
        redirect: "error",
        signal: AbortSignal.timeout(
          this.config.internalCommandTimeoutMs
        )
      });
    } catch {
      throw new RankResultClientError("UNAVAILABLE", true);
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      await response.body?.cancel().catch(() => undefined);
      throw new RankResultClientError("UNAVAILABLE", true);
    }
    const declared = response.headers.get("content-length");
    if (
      declared !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(declared) ||
        Number(declared) > RESPONSE_MAX_BYTES)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new RankResultClientError("UNAVAILABLE", true);
    }
    const payload = await boundedJson(response);
    if (!response.ok) throw responseError(response.status);
    const envelope = exactRecord(payload, ["data", "meta"]);
    const meta = envelope
      ? exactRecord(envelope.meta, ["requestId"])
      : undefined;
    if (
      !envelope ||
      !meta ||
      typeof meta.requestId !== "string" ||
      meta.requestId.length < 1 ||
      meta.requestId.length > 200
    ) {
      throw new RankResultClientError("UNAVAILABLE", true);
    }
    return receipt(envelope.data, input);
  }
}

function receipt(
  value: unknown,
  command: InternalIngestRankChunkInput
): InternalRankChunkIngestReceipt {
  const input = exactRecord(value, [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "ingestedBy",
    "jobId",
    "jobItemId",
    "manifestId",
    "chunkIndex",
    "manifestChunkHash",
    "providerRequestId",
    "connectorVersion",
    "observedAt",
    "ingestEnvelopeHash",
    "status",
    "persistedCount",
    "foundCount",
    "notFoundCount",
    "currentUpdatedCount",
    "currentSkippedCount",
    "appliedAt"
  ]);
  if (!input) throw new RankResultClientError("UNAVAILABLE", true);
  const persistedCount = decimal(input.persistedCount);
  const foundCount = decimal(input.foundCount);
  const notFoundCount = decimal(input.notFoundCount);
  const currentUpdatedCount = decimal(input.currentUpdatedCount);
  const currentSkippedCount = decimal(input.currentSkippedCount);
  if (
    input.schemaVersion !== "rank-ingest@1" ||
    input.workspaceId !== command.workspaceId ||
    input.projectId !== command.projectId ||
    !uuid(input.ingestedBy) ||
    input.jobId !== command.jobId ||
    input.jobItemId !== command.jobItemId ||
    input.manifestId !== command.manifestId ||
    input.chunkIndex !== command.chunkIndex ||
    !sameHash(input.manifestChunkHash, command.manifestChunkHash) ||
    input.providerRequestId !== command.providerRequestId ||
    input.connectorVersion !== command.connectorVersion ||
    input.observedAt !== command.observedAt ||
    !sameHash(input.ingestEnvelopeHash, command.ingestEnvelopeHash) ||
    input.status !== "APPLIED" ||
    persistedCount !== command.results.length ||
    foundCount + notFoundCount !== persistedCount ||
    foundCount !== command.results.filter((result) => result.found).length ||
    currentUpdatedCount + currentSkippedCount !== persistedCount ||
    !isoTimestamp(input.appliedAt)
  ) {
    throw new RankResultClientError("UNAVAILABLE", true);
  }
  return input as unknown as InternalRankChunkIngestReceipt;
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new RankResultClientError("UNAVAILABLE", true);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_MAX_BYTES) {
        await reader.cancel();
        throw new RankResultClientError("UNAVAILABLE", true);
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof RankResultClientError) throw error;
    throw new RankResultClientError("UNAVAILABLE", true);
  } finally {
    reader.releaseLock();
  }
}

function responseError(status: number): RankResultClientError {
  if (status === 409 || status === 412) {
    return new RankResultClientError("CONFLICT", false);
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return new RankResultClientError("INVALID_COMMAND", false);
  }
  return new RankResultClientError("UNAVAILABLE", true);
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    return undefined;
  }
  return input;
}

function sameHash(left: unknown, right: unknown): boolean {
  const input = exactRecord(left, ["algorithm", "value"]);
  const expected = exactRecord(right, ["algorithm", "value"]);
  return (
    input?.algorithm === "SHA_256" &&
    expected?.algorithm === "SHA_256" &&
    typeof input.value === "string" &&
    input.value === expected.value &&
    /^[a-f0-9]{64}$/u.test(input.value)
  );
}

function decimal(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,5})$/u.test(value)
  ) {
    throw new RankResultClientError("UNAVAILABLE", true);
  }
  return Number(value);
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  );
}

function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    new Date(value).toISOString() === value
  );
}
