import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalFinalizeCrawlSnapshotInput,
  InternalPersistCrawlPageInput,
  InternalPersistCrawlPageReceipt
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
      true
    );
    return persistReceipt(payload);
  }

  public finalize(input: InternalFinalizeCrawlSnapshotInput): Promise<void> {
    return this.request(
      "/internal/v1/crawl-snapshots/finalize",
      input,
      false
    ).then(() => undefined);
  }

  private async request(
    path: string,
    body: object,
    readResponse: boolean
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
    if (readResponse) return boundedJson(response);
    await response.body?.cancel().catch(() => undefined);
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 8_192) {
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
    if (bytes > 8_192) {
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
