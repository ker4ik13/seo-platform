import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalApplySemanticImportChunkInput,
  InternalBeginSemanticImportInput,
  InternalCompleteSemanticImportInput,
  InternalNormalizeSemanticKeywordsInput,
  InternalNormalizedSemanticKeyword,
  InternalNormalizeSemanticKeywordsResult,
  InternalSemanticImportChunkResult,
  InternalSemanticImportReceipt,
  SemanticImportResultSummary
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export class SeoDataClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_COMMAND"
      | "CONFLICT"
      | "NOT_FOUND"
      | "UNAVAILABLE",
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "SeoDataClientError";
  }
}

@Injectable()
export class SeoDataClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async normalizeKeywords(
    input: InternalNormalizeSemanticKeywordsInput
  ): Promise<InternalNormalizeSemanticKeywordsResult> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/normalize`,
      input
    );
    const result = normalizedKeywords(payload);
    if (
      !result ||
      result.rows.length !== input.rows.length ||
      new Set(result.rows.map(({ rowNumber }) => rowNumber)).size !==
        input.rows.length ||
      result.rows.some(
        ({ rowNumber }) =>
          !input.rows.some((row) => row.rowNumber === rowNumber)
      )
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async beginImport(
    input: InternalBeginSemanticImportInput
  ): Promise<InternalSemanticImportReceipt> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/begin`,
      input
    );
    const result = importReceipt(payload);
    if (!result || result.importId !== input.importId) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async applyChunk(
    input: InternalApplySemanticImportChunkInput
  ): Promise<InternalSemanticImportChunkResult> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/chunks`,
      input
    );
    const result = chunkResult(payload);
    if (!result || result.chunkIndex !== input.chunkIndex) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async completeImport(
    input: InternalCompleteSemanticImportInput
  ): Promise<SemanticImportResultSummary> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/complete`,
      input
    );
    const result = importResult(payload);
    if (!result) throw new SeoDataClientError("UNAVAILABLE", true);
    return result;
  }

  private async request(
    path: string,
    body: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    }
  ): Promise<unknown> {
    const token = this.config.internalApiToken;
    if (!token) throw new SeoDataClientError("UNAVAILABLE", true);
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.services.seoData), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Internal-Token": token,
          "X-Workspace-Id": body.workspaceId,
          "X-Project-Id": body.projectId,
          "X-Actor-Id": body.actorId
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.internalCommandTimeoutMs)
      });
    } catch {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw clientError(response.status);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload)
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return payload.data;
  }
}

function clientError(status: number): SeoDataClientError {
  if (status === 400 || status === 422) {
    return new SeoDataClientError("INVALID_COMMAND", false);
  }
  if (status === 404) {
    return new SeoDataClientError("NOT_FOUND", false);
  }
  if (status === 409) {
    return new SeoDataClientError("CONFLICT", false);
  }
  return new SeoDataClientError("UNAVAILABLE", true);
}

function normalizedKeywords(
  value: unknown
): InternalNormalizeSemanticKeywordsResult | undefined {
  const payload = object(value);
  if (!payload || !Array.isArray(payload.rows)) return undefined;
  const rows: InternalNormalizedSemanticKeyword[] = [];
  for (const value of payload.rows) {
    const row = object(value);
    if (
      !row ||
      !strings(
        row,
        "rowNumber",
        "textOriginal",
        "textNormalized",
        "normalizedHash",
        "language"
      ) ||
      typeof row.existsInProject !== "boolean" ||
      !/^[a-f0-9]{64}$/u.test(row.normalizedHash as string)
    ) {
      return undefined;
    }
    rows.push(row as unknown as InternalNormalizedSemanticKeyword);
  }
  return { rows };
}

function importReceipt(
  value: unknown
): InternalSemanticImportReceipt | undefined {
  const payload = object(value);
  if (
    !payload ||
    typeof payload.importId !== "string" ||
    !["RECEIVING", "COMPLETED"].includes(String(payload.status)) ||
    !nonNegativeInteger(payload.receivedChunks) ||
    !nonNegativeInteger(payload.expectedChunks)
  ) {
    return undefined;
  }
  return payload as unknown as InternalSemanticImportReceipt;
}

function chunkResult(
  value: unknown
): InternalSemanticImportChunkResult | undefined {
  const payload = object(value);
  if (
    !payload ||
    !nonNegativeInteger(payload.chunkIndex) ||
    !strings(
      payload,
      "createdKeywords",
      "updatedKeywords",
      "skippedKeywords",
      "createdGroups",
      "createdPages",
      "createdTags",
      "createdMetricSnapshots"
    )
  ) {
    return undefined;
  }
  return payload as unknown as InternalSemanticImportChunkResult;
}

function importResult(
  value: unknown
): SemanticImportResultSummary | undefined {
  const payload = object(value);
  if (
    !payload ||
    typeof payload.partial !== "boolean" ||
    !Number.isSafeInteger(payload.semanticVersionNumber) ||
    !strings(
      payload,
      "semanticVersionId",
      "createdKeywords",
      "updatedKeywords",
      "skippedKeywords",
      "createdGroups",
      "createdPages",
      "createdTags",
      "createdMetricSnapshots"
    )
  ) {
    return undefined;
  }
  return payload as unknown as SemanticImportResultSummary;
}

function object(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function strings(
  value: Readonly<Record<string, unknown>>,
  ...fields: readonly string[]
): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
