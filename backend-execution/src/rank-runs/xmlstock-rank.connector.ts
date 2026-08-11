import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import type {
  InternalNormalizedRankResult,
  RankManifestHash
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson
} from "@seo-platform/contracts/canonical-json";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { XmlStockHttpProduct } from "../integrations/xmlstock-http-quota-limiter.js";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import {
  providerTextRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";
import {
  matchesProject,
  providerUrl
} from "./arsenkin-rank.connector.js";
import {
  rankProviderRequestIntent,
  type RankProviderRequestIntentV1
} from "./rank-provider-request-intent.js";

const YANDEX_URL = new URL("https://xmlstock.com/yandex/xml/");
const YANDEX_LIVE_URL = new URL("https://xmlstock.com/yandexlive/xml/");
const GOOGLE_URL = new URL("https://xmlstock.com/google/xml/");
const STAGED_RESULT_SCHEMA = "xmlstock-rank-result@1" as const;
const WIRE_RESULT_SCHEMA = "xmlstock-rank-wire-result@1" as const;
const PAGE_PROGRESS_SCHEMA = "xmlstock-rank-page-progress@1" as const;
const MAX_RESPONSE_BYTES = 8 * 1_048_576;
const MAX_TITLE_LENGTH = 2_048;
const MAX_SNIPPET_LENGTH = 8_192;
const TASK_ID_PATTERN = /^[a-z0-9_-]{1,100}$/iu;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface XmlStockRankWireRequest {
  readonly provider: "XMLSTOCK";
  readonly engine: "YANDEX" | "GOOGLE";
  readonly source: "SEARCH_API" | "LIVE";
  readonly query: string;
  readonly regionCode: string;
  readonly countryCode: string;
  readonly language: string;
  readonly device: "DESKTOP" | "MOBILE";
  readonly depth: 30 | 50 | 100;
  readonly delayed: boolean;
}

export type XmlStockRankSubmitResult =
  | {
      readonly status: "ACCEPTED";
      readonly taskId: string;
      readonly request: XmlStockRankWireRequest;
    }
  | {
      readonly status: "RETRYABLE_FAILURE";
      readonly code: "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INVALID_CREDENTIAL"
        | "PROVIDER_PLAN_OR_REQUEST_REJECTED"
        | "INVALID_PROVIDER_RESPONSE";
    }
  | {
      readonly status: "OUTCOME_UNKNOWN";
      readonly code: "PROVIDER_TRANSPORT_AMBIGUOUS";
    };

export type XmlStockRankFetchResult =
  | { readonly status: "READY"; readonly value: unknown }
  | {
      readonly status: "CHECKPOINTED";
      readonly progress: XmlStockRankPageProgressV1;
      readonly hash: RankManifestHash;
    }
  | { readonly status: "PENDING" }
  | {
      readonly status: "RETRYABLE_FAILURE";
      readonly code: "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INVALID_CREDENTIAL"
        | "PROVIDER_PLAN_OR_REQUEST_REJECTED"
        | "INVALID_PROVIDER_RESPONSE";
    };

export interface XmlStockDocument {
  readonly position: number;
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
}

interface XmlStockWireResultV1 {
  readonly schemaVersion: "xmlstock-rank-wire-result@1";
  readonly engine: "YANDEX" | "GOOGLE";
  readonly documents: readonly XmlStockDocument[];
}

export interface XmlStockRankPageProgressV1 {
  readonly schemaVersion: "xmlstock-rank-page-progress@1";
  readonly taskId: string;
  readonly engine: "YANDEX" | "GOOGLE";
  readonly depth: 30 | 50 | 100;
  readonly nextPage: number;
  readonly documents: readonly XmlStockDocument[];
}

export interface XmlStockStagedRankResultV1 {
  readonly schemaVersion: "xmlstock-rank-result@1";
  readonly providerRequestId: string;
  readonly connectorVersion: string;
  readonly observedAt: string;
  readonly results: readonly InternalNormalizedRankResult[];
}

export interface XmlStockStagedRankResult {
  readonly snapshot: XmlStockStagedRankResultV1;
  readonly hash: RankManifestHash;
}

/**
 * XMLStock adapter for the documented Yandex delayed XML and Google XML
 * endpoints. One connector execution represents one keyword because the
 * provider does not expose a batch SERP endpoint.
 */
export class XmlStockRankConnector {
  public constructor(private readonly fetcher: ProviderFetch = fetch) {}

  public async submit(
    intentValue: unknown,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<XmlStockRankSubmitResult> {
    const intent = xmlStockIntent(intentValue);
    const request = buildXmlStockRankWireRequest(intent);
    if (!request.delayed) {
      return {
        status: "ACCEPTED",
        taskId: liveTaskId(intent),
        request
      };
    }
    try {
      const response = await providerTextRequest(
        yandexSubmitUrl(request, secret),
        requestInit(),
        timeoutMs,
        this.fetcher,
        Date.now,
        MAX_RESPONSE_BYTES
      );
      const failure = responseFailure(
        response.status,
        response.value,
        response.retryAfterSeconds,
        "SUBMIT"
      );
      if (failure) {
        return failure.status === "PENDING"
          ? { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" }
          : failure;
      }
      const parsed = parseXmlStockXml(response.value);
      if (!parsed.requestId || !TASK_ID_PATTERN.test(parsed.requestId)) {
        return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
      }
      return { status: "ACCEPTED", taskId: parsed.requestId, request };
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return {
          status: "OUTCOME_UNKNOWN",
          code: "PROVIDER_TRANSPORT_AMBIGUOUS"
        };
      }
      throw error;
    }
  }

  public async fetchResult(
    taskIdValue: string,
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    intentValue: unknown,
    progressValue?: unknown
  ): Promise<XmlStockRankFetchResult> {
    const intent = xmlStockIntent(intentValue);
    const taskId = providerTaskId(taskIdValue);
    try {
      const request = buildXmlStockRankWireRequest(intent);
      return request.delayed
        ? await this.fetchYandexSearchApi(taskId, secret, timeoutMs, intent)
        : await this.fetchLivePage(
            taskId,
            secret,
            timeoutMs,
            intent,
            request,
            progressValue
          );
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return {
          status: "RETRYABLE_FAILURE",
          code: "PROVIDER_UNAVAILABLE"
        };
      }
      throw error;
    }
  }

  private async fetchYandexSearchApi(
    taskId: string,
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    intent: RankProviderRequestIntentV1
  ): Promise<XmlStockRankFetchResult> {
    const response = await providerTextRequest(
      yandexPollUrl(taskId, secret),
      requestInit(),
      timeoutMs,
      this.fetcher,
      Date.now,
      MAX_RESPONSE_BYTES
    );
    const failure = responseFailure(
      response.status,
      response.value,
      response.retryAfterSeconds,
      "POLL"
    );
    if (failure) return failure;
    const parsed = parseXmlStockXml(response.value);
    if (parsed.requestId && parsed.requestId !== taskId) {
      return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
    }
    return {
      status: "READY",
      value: wireResult("YANDEX", parsed.documents, intent.execution.depth)
    };
  }

  private async fetchLivePage(
    taskId: string,
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    intent: RankProviderRequestIntentV1,
    request: XmlStockRankWireRequest,
    progressValue?: unknown
  ): Promise<XmlStockRankFetchResult> {
    if (taskId !== liveTaskId(intent)) {
      return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
    }
    const pageCount = Math.ceil(request.depth / 10);
    const progress = progressValue === undefined
      ? undefined
      : xmlStockRankPageProgress(progressValue);
    if (
      progress &&
      (progress.taskId !== taskId ||
        progress.engine !== request.engine ||
        progress.depth !== request.depth ||
        progress.nextPage >= pageCount)
    ) {
      invalid();
    }
    const page = progress?.nextPage ?? 0;
    const documents = [...(progress?.documents ?? [])];
    const response = await providerTextRequest(
      livePageUrl(request, secret, page),
      requestInit(),
      timeoutMs,
      this.fetcher,
      Date.now,
      MAX_RESPONSE_BYTES
    );
    const failure = responseFailure(
      response.status,
      response.value,
      response.retryAfterSeconds,
      "POLL"
    );
    if (failure) return failure;
    const parsed = parseXmlStockXml(response.value);
    documents.push(
      ...parsed.documents.map((document, index) => ({
        ...document,
        position: page * 10 + index + 1
      }))
    );
    const nextPage = page + 1;
    if (parsed.documents.length === 10 && nextPage < pageCount) {
      const checkpoint = xmlStockRankPageProgress({
        schemaVersion: PAGE_PROGRESS_SCHEMA,
        taskId,
        engine: request.engine,
        depth: request.depth,
        nextPage,
        documents
      });
      return {
        status: "CHECKPOINTED",
        progress: checkpoint,
        hash: xmlStockRankPageProgressHash(checkpoint)
      };
    }
    return {
      status: "READY",
      value: wireResult(request.engine, documents, request.depth)
    };
  }
}

export function xmlStockRankPageProgress(
  value: unknown
): XmlStockRankPageProgressV1 {
  const input = record(value);
  if (
    Object.keys(input).length !== 6 ||
    input.schemaVersion !== PAGE_PROGRESS_SCHEMA ||
    typeof input.taskId !== "string" ||
    (input.engine !== "YANDEX" && input.engine !== "GOOGLE") ||
    (input.depth !== 30 && input.depth !== 50 && input.depth !== 100) ||
    !Number.isSafeInteger(input.nextPage) ||
    Number(input.nextPage) < 1 ||
    Number(input.nextPage) >= Math.ceil(Number(input.depth) / 10) ||
    !Array.isArray(input.documents) ||
    input.documents.length !== Number(input.nextPage) * 10
  ) {
    invalid();
  }
  const documents = input.documents.map((document, index) => {
    const parsed = record(document);
    const allowed = new Set(["position", "url", "title", "snippet"]);
    if (
      Object.keys(parsed).some((field) => !allowed.has(field)) ||
      !Number.isSafeInteger(parsed.position) ||
      parsed.position !== index + 1 ||
      typeof parsed.url !== "string" ||
      parsed.url.length < 1 ||
      (parsed.title !== undefined &&
        (typeof parsed.title !== "string" ||
          parsed.title.length > MAX_TITLE_LENGTH)) ||
      (parsed.snippet !== undefined &&
        (typeof parsed.snippet !== "string" ||
          parsed.snippet.length > MAX_SNIPPET_LENGTH))
    ) {
      invalid();
    }
    return {
      position: Number(parsed.position),
      url: providerUrl(parsed.url).original,
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(parsed.snippet === undefined ? {} : { snippet: parsed.snippet })
    };
  });
  const progress: XmlStockRankPageProgressV1 = {
    schemaVersion: PAGE_PROGRESS_SCHEMA,
    taskId: providerTaskId(input.taskId),
    engine: input.engine,
    depth: input.depth,
    nextPage: Number(input.nextPage),
    documents
  };
  canonicalizeJson(progress);
  return progress;
}

export function xmlStockRankPageProgressHash(
  value: unknown
): RankManifestHash {
  const progress = xmlStockRankPageProgress(value);
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(PAGE_PROGRESS_SCHEMA, progress)
  };
}

export function buildXmlStockRankWireRequest(
  intentValue: unknown
): XmlStockRankWireRequest {
  const intent = xmlStockIntent(intentValue);
  const keyword = intent.keywords[0];
  if (!keyword || !intent.execution.regionCode) invalid();
  return {
    provider: "XMLSTOCK",
    engine: intent.execution.searchEngine,
    source: xmlStockSearchSource(intent.execution.providerMappingVersion),
    query: keyword.keywordText,
    regionCode: intent.execution.regionCode,
    countryCode: intent.execution.countryCode,
    language: intent.execution.language,
    device: intent.execution.device,
    depth: intent.execution.depth,
    delayed:
      intent.execution.searchEngine === "YANDEX" &&
      xmlStockSearchSource(intent.execution.providerMappingVersion) ===
        "SEARCH_API"
  };
}

export function xmlStockRankWireRequestHash(
  value: XmlStockRankWireRequest
): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256("xmlstock-rank-request@1", value)
  };
}

export function xmlStockRankHttpProduct(
  request: XmlStockRankWireRequest
): Exclude<XmlStockHttpProduct, "WORDSTAT"> {
  if (request.delayed) return "YANDEX_SEARCH_API";
  return request.engine === "GOOGLE" ? "GOOGLE_LIVE" : "YANDEX_LIVE";
}

export function stageXmlStockRankResult(
  value: unknown,
  taskIdValue: string,
  intentValue: unknown,
  observedAtValue: string
): XmlStockStagedRankResult {
  const taskId = providerTaskId(taskIdValue);
  const intent = xmlStockIntent(intentValue);
  const observedAt = timestamp(observedAtValue);
  const snapshot: XmlStockStagedRankResultV1 = {
    schemaVersion: STAGED_RESULT_SCHEMA,
    providerRequestId: taskId,
    connectorVersion: intent.executionConnectorVersion,
    observedAt,
    results: normalizeXmlStockRankResult(value, intent)
  };
  canonicalizeJson(snapshot);
  return {
    snapshot,
    hash: {
      algorithm: "SHA_256",
      value: canonicalJsonSha256(STAGED_RESULT_SCHEMA, snapshot)
    }
  };
}

export function xmlStockStagedRankResult(
  value: unknown
): XmlStockStagedRankResultV1 {
  const input = record(value);
  if (
    Object.keys(input).length !== 5 ||
    input.schemaVersion !== STAGED_RESULT_SCHEMA ||
    typeof input.providerRequestId !== "string" ||
    typeof input.connectorVersion !== "string" ||
    typeof input.observedAt !== "string" ||
    !Array.isArray(input.results) ||
    input.results.length !== 1
  ) {
    invalid();
  }
  const snapshot: XmlStockStagedRankResultV1 = {
    schemaVersion: STAGED_RESULT_SCHEMA,
    providerRequestId: providerTaskId(input.providerRequestId),
    connectorVersion: version(input.connectorVersion),
    observedAt: timestamp(input.observedAt),
    results: input.results as readonly InternalNormalizedRankResult[]
  };
  canonicalizeJson(snapshot);
  return snapshot;
}

export function xmlStockStagedRankResultHash(value: unknown): RankManifestHash {
  const snapshot = xmlStockStagedRankResult(value);
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(STAGED_RESULT_SCHEMA, snapshot)
  };
}

function normalizeXmlStockRankResult(
  value: unknown,
  intent: RankProviderRequestIntentV1
): readonly InternalNormalizedRankResult[] {
  const input = wireResultValue(value);
  if (input.engine !== intent.execution.searchEngine) invalid();
  const keyword = intent.keywords[0];
  if (!keyword) invalid();
  const serpResults = input.documents.slice(0, 10).map((document, index) => {
    const rankingUrl = providerUrl(document.url);
    return {
      position: index + 1,
      rankingUrl: rankingUrl.original,
      normalizedRankingUrl: rankingUrl.normalized,
      ...(document.title ? { title: document.title } : {}),
      ...(document.snippet ? { snippet: document.snippet } : {})
    };
  });
  const match = input.documents.find((document) => {
    try {
      return matchesProject(
        new URL(document.url),
        intent.project.domain,
        intent.execution.domainMatchRule
      );
    } catch {
      return false;
    }
  });
  if (!match) {
    return [{
      manifestEntryId: keyword.manifestEntryId,
      keywordId: keyword.keywordId,
      found: false,
      position: null,
      serpResults,
      dataQualityFlags: ["PROVIDER_OBSERVED_AT_UNAVAILABLE"]
    }];
  }
  const rankingUrl = providerUrl(match.url);
  return [{
    manifestEntryId: keyword.manifestEntryId,
    keywordId: keyword.keywordId,
    found: true,
    position: match.position,
    rankingUrl: rankingUrl.original,
    normalizedRankingUrl: rankingUrl.normalized,
    ...(match.title ? { title: match.title } : {}),
    ...(match.snippet ? { snippet: match.snippet } : {}),
    resultType: "ORGANIC",
    serpFeatures: [],
    serpResults,
    dataQualityFlags: [
      "PROVIDER_OBSERVED_AT_UNAVAILABLE",
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      ...(match.title ? [] : ["TITLE_UNAVAILABLE"] as const),
      ...(match.snippet ? [] : ["SNIPPET_UNAVAILABLE"] as const)
    ]
  }];
}

function yandexSubmitUrl(
  request: XmlStockRankWireRequest,
  secret: IntegrationCredentialSecret
): URL {
  const url = authenticatedUrl(YANDEX_URL, secret);
  url.searchParams.set("query", request.query);
  url.searchParams.set("lr", request.regionCode);
  url.searchParams.set("groupby", String(request.depth));
  url.searchParams.set("device", device(request.device));
  url.searchParams.set("domain", request.countryCode.toLowerCase());
  url.searchParams.set("delayed", "1");
  return url;
}

function yandexPollUrl(
  taskId: string,
  secret: IntegrationCredentialSecret
): URL {
  const url = authenticatedUrl(YANDEX_URL, secret);
  url.searchParams.set("req_id", taskId);
  return url;
}

function livePageUrl(
  request: XmlStockRankWireRequest,
  secret: IntegrationCredentialSecret,
  page: number
): URL {
  const url = authenticatedUrl(
    request.engine === "YANDEX" ? YANDEX_LIVE_URL : GOOGLE_URL,
    secret
  );
  url.searchParams.set("query", request.query);
  url.searchParams.set("lr", request.regionCode);
  url.searchParams.set("page", String(page));
  url.searchParams.set("device", device(request.device));
  url.searchParams.set("domain", request.countryCode.toLowerCase());
  if (request.engine === "YANDEX") {
    url.searchParams.set(
      "lang",
      request.language.toLowerCase().startsWith("en") ? "en" : "ru"
    );
  } else {
    url.searchParams.set("hl", request.language.split("-", 1)[0] ?? "ru");
  }
  return url;
}

function authenticatedUrl(
  base: URL,
  secret: IntegrationCredentialSecret
): URL {
  if (!secret.accountIdentifier) invalid();
  const url = new URL(base);
  url.searchParams.set("user", secret.accountIdentifier);
  url.searchParams.set("key", secret.apiKey);
  return url;
}

function requestInit(): RequestInit {
  return {
    method: "GET",
    headers: { Accept: "application/xml, text/xml;q=0.9" }
  };
}

function responseFailure(
  status: number,
  xml: string,
  retryAfterSeconds: number | undefined,
  stage: "SUBMIT" | "POLL"
): Exclude<
  XmlStockRankFetchResult,
  { readonly status: "READY" | "CHECKPOINTED" }
> |
  Exclude<XmlStockRankSubmitResult, { readonly status: "ACCEPTED" | "OUTCOME_UNKNOWN" }> |
  undefined {
  if (status === 429 || status === 503) {
    return {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_RATE_LIMITED",
      ...(retryAfterSeconds === undefined ? { retryAfterSeconds: 30 } : { retryAfterSeconds })
    };
  }
  if (status >= 500 && status <= 599) {
    return { status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE" };
  }
  if (status < 200 || status >= 300) {
    return { status: "REJECTED", code: "PROVIDER_PLAN_OR_REQUEST_REJECTED" };
  }
  const parsed = parseXmlStockXml(xml);
  const code = parsed.errorCode;
  if (!code || code === "15") return undefined;
  if (["-34", "31", "42"].includes(code)) {
    return { status: "REJECTED", code: "INVALID_CREDENTIAL" };
  }
  if (["32", "55", "110", "201", "429", "503"].includes(code)) {
    return {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_RATE_LIMITED",
      retryAfterSeconds: 30
    };
  }
  if (["20", "21", "22", "23", "24", "25", "101"].includes(code)) {
    return { status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE" };
  }
  if (stage === "POLL" && ["202", "210"].includes(code)) {
    return { status: "PENDING" };
  }
  return { status: "REJECTED", code: "PROVIDER_PLAN_OR_REQUEST_REJECTED" };
}

function parseXmlStockXml(xml: string): {
  readonly requestId?: string;
  readonly errorCode?: string;
  readonly documents: readonly Omit<XmlStockDocument, "position">[];
} {
  let requestId: string | undefined;
  let errorCode: string | undefined;
  const documents: Array<Omit<XmlStockDocument, "position">> = [];
  const names: string[] = [];
  const texts: string[] = [];
  let current: { url?: string; title?: string; snippets: string[] } | undefined;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const name = String(tag.name).toLowerCase();
    names.push(name);
    texts.push("");
    if (name === "doc") current = { snippets: [] };
    if (name === "error") {
      const attribute = tag.attributes.code;
      if (attribute !== undefined) errorCode = String(attribute);
    }
  });
  const append = (text: string) => {
    const index = texts.length - 1;
    if (index >= 0) texts[index] = `${texts[index] ?? ""}${text}`;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", (tag) => {
    const name = String(tag.name).toLowerCase();
    const text = (texts.pop() ?? "").trim();
    const opened = names.pop();
    if (opened !== name) invalid();
    if (name === "req_id" && text) requestId = text;
    if (current) {
      if (name === "url" && text) current.url = text;
      if (name === "title" && text) current.title = text;
      if (name === "passage" && text) current.snippets.push(text);
      if (name === "doc") {
        if (!current.url) invalid();
        documents.push({
          url: current.url,
          ...(current.title ? { title: current.title } : {}),
          ...(current.snippets.length > 0
            ? { snippet: current.snippets.join(" ") }
            : {})
        });
        current = undefined;
      }
    }
  });
  parser.write(xml).close();
  return {
    ...(requestId ? { requestId } : {}),
    ...(errorCode ? { errorCode } : {}),
    documents
  };
}

function wireResult(
  engine: "YANDEX" | "GOOGLE",
  documents: readonly Omit<XmlStockDocument, "position">[] | readonly XmlStockDocument[],
  depth: number
): XmlStockWireResultV1 {
  return {
    schemaVersion: WIRE_RESULT_SCHEMA,
    engine,
    documents: documents.slice(0, depth).map((document, index) => ({
      ...document,
      position:
        "position" in document && typeof document.position === "number"
          ? document.position
          : index + 1
    }))
  };
}

function wireResultValue(value: unknown): XmlStockWireResultV1 {
  const input = record(value);
  if (
    input.schemaVersion !== WIRE_RESULT_SCHEMA ||
    (input.engine !== "YANDEX" && input.engine !== "GOOGLE") ||
    !Array.isArray(input.documents)
  ) {
    invalid();
  }
  const documents = input.documents.map((value) => {
    const document = record(value);
    if (
      !Number.isSafeInteger(document.position) ||
      Number(document.position) < 1 ||
      Number(document.position) > 100 ||
      typeof document.url !== "string"
    ) {
      invalid();
    }
    return {
      position: Number(document.position),
      url: providerUrl(document.url).original,
      ...(typeof document.title === "string" && document.title
        ? { title: document.title }
        : {}),
      ...(typeof document.snippet === "string" && document.snippet
        ? { snippet: document.snippet }
        : {})
    };
  });
  return { schemaVersion: WIRE_RESULT_SCHEMA, engine: input.engine, documents };
}

function liveTaskId(intent: RankProviderRequestIntentV1): string {
  return `xmlstock-live-${createHash("sha256")
    .update(canonicalizeJson(intent), "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function xmlStockSearchSource(
  providerMappingVersion: string
): "SEARCH_API" | "LIVE" {
  if (
    providerMappingVersion === "xmlstock-yandex-live@2" ||
    providerMappingVersion === "xmlstock-google-live@2"
  ) {
    return "LIVE";
  }
  return "SEARCH_API";
}

function xmlStockIntent(value: unknown): RankProviderRequestIntentV1 {
  const intent = rankProviderRequestIntent(value);
  if (intent.provider !== "XMLSTOCK" || intent.keywords.length !== 1) invalid();
  return intent;
}

function providerTaskId(value: unknown): string {
  if (typeof value !== "string" || !TASK_ID_PATTERN.test(value)) invalid();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) invalid();
  return value;
}

function version(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9@._-]{0,63}$/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function device(value: "DESKTOP" | "MOBILE"): "desktop" | "mobile" {
  return value === "MOBILE" ? "mobile" : "desktop";
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
}

function invalid(): never {
  throw new TypeError("Invalid XMLStock rank response");
}
