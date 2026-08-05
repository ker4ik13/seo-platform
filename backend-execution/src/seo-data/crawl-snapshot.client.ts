import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalCrawlPageValidator,
  InternalFinalizeCrawlSnapshotInput,
  InternalFinalizeCrawlSnapshotReceipt,
  InternalGetCrawlPageValidatorInput,
  InternalPersistCrawlPageInput,
  InternalPersistCrawlPageReceipt,
  InternalReuseCrawlPageInput
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

@Injectable()
export class CrawlSnapshotClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async persistPage(
    input: InternalPersistCrawlPageInput
  ): Promise<InternalPersistCrawlPageReceipt> {
    const payload = await this.request(
      "/internal/v1/crawl-snapshots/pages",
      input,
      8_192
    );
    return persistReceipt(payload);
  }

  public async validator(
    input: InternalGetCrawlPageValidatorInput
  ): Promise<InternalCrawlPageValidator | null> {
    const payload = await this.request(
      "/internal/v1/crawl-snapshots/validators",
      input,
      4_000_000
    );
    return validatorReceipt(payload);
  }

  public async reusePage(
    input: InternalReuseCrawlPageInput
  ): Promise<InternalPersistCrawlPageReceipt> {
    const payload = await this.request(
      "/internal/v1/crawl-snapshots/pages/reuse",
      input,
      8_192
    );
    return persistReceipt(payload);
  }

  public async finalize(
    input: InternalFinalizeCrawlSnapshotInput
  ): Promise<InternalFinalizeCrawlSnapshotReceipt> {
    const payload = await this.request(
      "/internal/v1/crawl-snapshots/finalize",
      input,
      8_192
    );
    return finalizeReceipt(payload);
  }

  private async request(
    path: string,
    body: object,
    responseLimit: number | undefined
  ): Promise<unknown> {
    const token = this.config.seoDataApiToken;
    if (!token) throw new Error("SEO Data crawl authentication is unavailable");
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.services.seoData), {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Internal-Token": token
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.internalCommandTimeoutMs)
      });
    } catch {
      throw new Error("SEO Data crawl persistence is unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("SEO Data rejected crawl persistence");
    }
    if (responseLimit) return boundedJson(response, responseLimit);
    await response.body?.cancel().catch(() => undefined);
  }
}

async function boundedJson(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("SEO Data crawl response is invalid");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SEO Data crawl response is invalid");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("SEO Data crawl response is invalid");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    bytes
  ).toString("utf8");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("SEO Data crawl response is invalid");
  }
}

function persistReceipt(value: unknown): InternalPersistCrawlPageReceipt {
  const envelope = exactRecord(value, ["data", "meta"]);
  const data = exactRecord(envelope.data, [
    "accepted",
    "issueCount",
    "success"
  ]);
  const meta = exactRecord(envelope.meta, ["requestId"]);
  if (
    data.accepted !== true ||
    typeof data.success !== "boolean" ||
    !Number.isSafeInteger(data.issueCount) ||
    Number(data.issueCount) < 0 ||
    Number(data.issueCount) > 100 ||
    typeof meta.requestId !== "string" ||
    meta.requestId.length < 1 ||
    meta.requestId.length > 100
  ) {
    throw new Error("SEO Data crawl response is invalid");
  }
  return {
    accepted: true,
    issueCount: Number(data.issueCount),
    success: data.success
  };
}

function finalizeReceipt(
  value: unknown
): InternalFinalizeCrawlSnapshotReceipt {
  const envelope = exactRecord(value, ["data", "meta"]);
  const data = exactRecord(envelope.data, ["accepted", "issueCount"]);
  const meta = exactRecord(envelope.meta, ["requestId"]);
  if (
    data.accepted !== true ||
    !Number.isSafeInteger(data.issueCount) ||
    Number(data.issueCount) < 0 ||
    Number(data.issueCount) > 5_000 ||
    typeof meta.requestId !== "string" ||
    meta.requestId.length < 1 ||
    meta.requestId.length > 100
  ) {
    throw new Error("SEO Data crawl response is invalid");
  }
  return { accepted: true, issueCount: Number(data.issueCount) };
}

function validatorReceipt(
  value: unknown
): InternalCrawlPageValidator | null {
  const envelope = exactRecord(value, ["data", "meta"]);
  const meta = exactRecord(envelope.meta, ["requestId"]);
  if (
    typeof meta.requestId !== "string" ||
    meta.requestId.length < 1 ||
    meta.requestId.length > 100
  ) {
    throw new Error("SEO Data crawl response is invalid");
  }
  if (envelope.data === null) return null;
  const data = recordWithOptional(
    envelope.data,
    ["sourceSnapshotId", "internalLinks"],
    ["etag", "lastModified"]
  );
  if (
    typeof data.sourceSnapshotId !== "string" ||
    !UUID_PATTERN.test(data.sourceSnapshotId) ||
    !Array.isArray(data.internalLinks) ||
    data.internalLinks.length > 5_000 ||
    data.internalLinks.some((url) => !safeUrl(url)) ||
    (
      data.etag === undefined &&
      data.lastModified === undefined
    ) ||
    (
      data.etag !== undefined &&
      !safeHeader(data.etag, 1_000)
    ) ||
    (
      data.lastModified !== undefined &&
      !safeHeader(data.lastModified, 128)
    )
  ) {
    throw new Error("SEO Data crawl response is invalid");
  }
  return {
    sourceSnapshotId: data.sourceSnapshotId,
    ...(typeof data.etag === "string" ? { etag: data.etag } : {}),
    ...(typeof data.lastModified === "string"
      ? { lastModified: data.lastModified }
      : {}),
    internalLinks: data.internalLinks as readonly string[]
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error("SEO Data crawl response is invalid");
  }
  return value as Readonly<Record<string, unknown>>;
}

function recordWithOptional(
  value: unknown,
  required: readonly string[],
  optional: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    required.some((key) => !(key in value)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key)
    )
  ) {
    throw new Error("SEO Data crawl response is invalid");
  }
  return value as Readonly<Record<string, unknown>>;
}

function safeHeader(value: unknown, max: number): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= max &&
    /^[\u0020-\u007e]+$/u.test(value)
  );
}

function safeUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
