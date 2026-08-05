import {
  normalizedRankDataQualityFlags,
  operationResultItemStatuses,
  semanticFrequencyDevices,
  semanticFrequencyQualityFlags,
  semanticFrequencyTypes,
  type CrawlOperationResultRow,
  type InternalCrawlOperationResultPage,
  type InternalFrequencyOperationResult,
  type InternalRankExecutionParameters,
  type InternalRankOperationResult,
  type RankOperationResultRow
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function scopedInternalFrequencyOperationResult(
  value: unknown,
  workspaceId: string,
  projectId: string,
  jobId: string,
  expectedKeywordIds: readonly string[]
): InternalFrequencyOperationResult {
  const input = exact(value, ["workspaceId", "projectId", "jobId", "rows"]);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    input.jobId !== jobId ||
    !Array.isArray(input.rows) ||
    input.rows.length !== expectedKeywordIds.length
  ) invalid();
  const seen = new Set<string>();
  const rows = input.rows.map((value) => {
    const row = exact(value, ["keywordId", "keyword", "snapshots"]);
    const keywordId = uuid(row.keywordId);
    if (
      !expectedKeywordIds.includes(keywordId) ||
      seen.has(keywordId) ||
      typeof row.keyword !== "string" ||
      row.keyword.length < 1 ||
      row.keyword.length > 2_000 ||
      !Array.isArray(row.snapshots) ||
      row.snapshots.length > 3
    ) invalid();
    seen.add(keywordId);
    const types = new Set<string>();
    return {
      keywordId,
      keyword: row.keyword,
      snapshots: row.snapshots.map((value) => {
        const snapshot = exact(
          value,
          [
            "type",
            "regionCode",
            "device",
            "provider",
            "sourceMode",
            "jobId",
            "qualityFlags",
            "observedAt"
          ],
          ["period", "value"]
        );
        const type = member(snapshot.type, semanticFrequencyTypes);
        if (
          types.has(type) ||
          typeof snapshot.regionCode !== "string" ||
          snapshot.regionCode.length < 1 ||
          snapshot.regionCode.length > 100 ||
          (snapshot.period !== undefined &&
            (typeof snapshot.period !== "string" ||
              snapshot.period.length > 32)) ||
          (snapshot.value !== undefined &&
            (typeof snapshot.value !== "string" ||
              !/^(?:0|[1-9]\d{0,18})$/u.test(snapshot.value))) ||
          typeof snapshot.provider !== "string" ||
          snapshot.provider.length < 1 ||
          snapshot.provider.length > 64 ||
          !["BYOK", "PLATFORM", "IMPORT", "MANUAL"].includes(
            String(snapshot.sourceMode)
          ) ||
          snapshot.jobId !== jobId ||
          !Array.isArray(snapshot.qualityFlags) ||
          snapshot.qualityFlags.length > semanticFrequencyQualityFlags.length
        ) invalid();
        types.add(type);
        const qualityFlags = snapshot.qualityFlags.map((flag) =>
          member(flag, semanticFrequencyQualityFlags)
        );
        if (new Set(qualityFlags).size !== qualityFlags.length) invalid();
        return {
          type,
          regionCode: snapshot.regionCode,
          device: member(snapshot.device, semanticFrequencyDevices),
          ...(typeof snapshot.period === "string"
            ? { period: snapshot.period }
            : {}),
          ...(typeof snapshot.value === "string"
            ? { value: snapshot.value }
            : {}),
          provider: snapshot.provider,
          sourceMode: snapshot.sourceMode as "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL",
          jobId,
          qualityFlags,
          observedAt: timestamp(snapshot.observedAt)
        };
      })
    };
  });
  if (seen.size !== expectedKeywordIds.length) invalid();
  return { workspaceId, projectId, jobId, rows };
}

export function scopedInternalRankOperationResult(
  value: unknown,
  workspaceId: string,
  projectId: string,
  jobId: string
): InternalRankOperationResult {
  const input = exact(value, [
    "workspaceId",
    "projectId",
    "jobId",
    "trackingContextId",
    "contextName",
    "execution",
    "rows"
  ]);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    input.jobId !== jobId ||
    typeof input.contextName !== "string" ||
    input.contextName.length < 1 ||
    input.contextName.length > 160 ||
    !Array.isArray(input.rows) ||
    input.rows.length > 1_000
  ) invalid();
  const keywordIds = new Set<string>();
  const sequences = new Set<number>();
  const rows = input.rows.map((value): RankOperationResultRow => {
    const row = exact(
      value,
      ["sequence", "keywordId", "keyword", "state", "dataQualityFlags"],
      [
        "position",
        "absolutePosition",
        "pixelPosition",
        "rankingUrl",
        "title",
        "snippet",
        "observedAt"
      ]
    );
    const keywordId = uuid(row.keywordId);
    const sequence = integer(row.sequence, 0, 999);
    if (
      keywordIds.has(keywordId) ||
      sequences.has(sequence) ||
      typeof row.keyword !== "string" ||
      row.keyword.length < 1 ||
      row.keyword.length > 2_000 ||
      !["PENDING", "FOUND", "NOT_FOUND"].includes(String(row.state)) ||
      !Array.isArray(row.dataQualityFlags) ||
      row.dataQualityFlags.length > normalizedRankDataQualityFlags.length
    ) invalid();
    keywordIds.add(keywordId);
    sequences.add(sequence);
    const dataQualityFlags = row.dataQualityFlags.map((flag) =>
      member(flag, normalizedRankDataQualityFlags)
    );
    if (new Set(dataQualityFlags).size !== dataQualityFlags.length) invalid();
    if (row.state === "FOUND") {
      if (
        typeof row.rankingUrl !== "string" ||
        !URL.canParse(row.rankingUrl) ||
        row.position === undefined ||
        row.observedAt === undefined
      ) invalid();
      return {
        sequence,
        keywordId,
        keyword: row.keyword,
        state: "FOUND",
        position: integer(row.position, 1, 100),
        ...optionalInteger(row.absolutePosition, "absolutePosition"),
        ...optionalInteger(row.pixelPosition, "pixelPosition", 0),
        rankingUrl: row.rankingUrl,
        ...optionalBoundedString(row.title, "title", 10_000),
        ...optionalBoundedString(row.snippet, "snippet", 20_000),
        observedAt: timestamp(row.observedAt),
        dataQualityFlags
      };
    }
    if (
      row.position !== undefined ||
      row.absolutePosition !== undefined ||
      row.pixelPosition !== undefined ||
      row.rankingUrl !== undefined ||
      row.title !== undefined ||
      row.snippet !== undefined ||
      (row.state === "PENDING" && row.observedAt !== undefined) ||
      (row.state === "NOT_FOUND" && row.observedAt === undefined)
    ) invalid();
    return {
      sequence,
      keywordId,
      keyword: row.keyword,
      state: row.state as "PENDING" | "NOT_FOUND",
      ...(row.state === "NOT_FOUND"
        ? { observedAt: timestamp(row.observedAt) }
        : {}),
      dataQualityFlags
    };
  });
  return {
    workspaceId,
    projectId,
    jobId,
    trackingContextId: uuid(input.trackingContextId),
    contextName: input.contextName,
    execution: rankExecution(input.execution),
    rows
  };
}

export function scopedInternalCrawlOperationResultPage(
  value: unknown,
  workspaceId: string,
  projectId: string,
  crawlId: string,
  limit: number
): InternalCrawlOperationResultPage {
  const input = exact(value, [
    "workspaceId",
    "projectId",
    "crawlId",
    "rows",
    "page"
  ]);
  const page = exact(input.page, ["hasNext"], ["nextCursor"]);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    input.crawlId !== crawlId ||
    !Array.isArray(input.rows) ||
    input.rows.length > limit ||
    typeof page.hasNext !== "boolean" ||
    (page.hasNext && typeof page.nextCursor !== "string") ||
    (!page.hasNext && page.nextCursor !== undefined)
  ) invalid();
  const sequences = new Set<number>();
  const rows = input.rows.map((value): CrawlOperationResultRow => {
    const row = exact(
      value,
      [
        "sequence",
        "requestedUrl",
        "finalUrl",
        "redirectChain",
        "statusCode",
        "responseTimeMs",
        "sizeBytes",
        "contentType",
        "indexability",
        "inSitemap",
        "depth",
        "wordCount",
        "internalLinkCount",
        "externalLinkCount",
        "issues",
        "crawledAt"
      ],
      ["title", "h1", "canonicalUrl"]
    );
    const sequence = integer(row.sequence, 0, 999);
    if (
      sequences.has(sequence) ||
      typeof row.requestedUrl !== "string" ||
      !URL.canParse(row.requestedUrl) ||
      typeof row.finalUrl !== "string" ||
      !URL.canParse(row.finalUrl) ||
      typeof row.contentType !== "string" ||
      ![
        "INDEXABLE",
        "NOINDEX",
        "BLOCKED_ROBOTS",
        "CANONICALIZED",
        "REDIRECTED",
        "ERROR",
        "UNKNOWN"
      ].includes(String(row.indexability)) ||
      typeof row.inSitemap !== "boolean" ||
      !Array.isArray(row.issues) ||
      row.issues.length > 100
    ) invalid();
    sequences.add(sequence);
    return {
      sequence,
      requestedUrl: row.requestedUrl,
      finalUrl: row.finalUrl,
      redirectChain: safeUrlArray(row.redirectChain, 10),
      statusCode: integer(row.statusCode, 100, 599),
      responseTimeMs: integer(row.responseTimeMs, 0),
      sizeBytes: integer(row.sizeBytes, 0),
      contentType: row.contentType,
      ...optionalBoundedString(row.title, "title", 10_000),
      ...optionalBoundedString(row.h1, "h1", 10_000),
      ...(typeof row.canonicalUrl === "string"
        ? { canonicalUrl: safeUrl(row.canonicalUrl) }
        : {}),
      indexability: row.indexability as CrawlOperationResultRow["indexability"],
      inSitemap: row.inSitemap,
      depth: integer(row.depth, 0, 20),
      wordCount: integer(row.wordCount, 0),
      internalLinkCount: integer(row.internalLinkCount, 0),
      externalLinkCount: integer(row.externalLinkCount, 0),
      issues: row.issues.map((value) => {
        const issue = exact(value, ["code", "severity", "title"]);
        if (
          typeof issue.code !== "string" ||
          !/^[A-Z][A-Z0-9_]{0,63}$/u.test(issue.code) ||
          !["INFO", "WARNING", "ERROR", "CRITICAL"].includes(
            String(issue.severity)
          ) ||
          typeof issue.title !== "string" ||
          issue.title.length < 1 ||
          issue.title.length > 255
        ) invalid();
        return {
          code: issue.code,
          severity: issue.severity as "INFO" | "WARNING" | "ERROR" | "CRITICAL",
          title: issue.title
        };
      }),
      crawledAt: timestamp(row.crawledAt)
    };
  });
  return {
    workspaceId,
    projectId,
    crawlId,
    rows,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {})
    }
  };
}

function rankExecution(value: unknown): InternalRankExecutionParameters {
  const input = exact(value, [
    "searchEngine",
    "countryCode",
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    "format",
    "rawSerp",
    "fallbackMode",
    "providerMappingVersion"
  ], ["regionCode"]);
  const rule = exact(input.domainMatchRule, ["mode"], ["value"]);
  const mode = String(rule.mode);
  if (
    !["GOOGLE", "YANDEX"].includes(String(input.searchEngine)) ||
    typeof input.countryCode !== "string" ||
    typeof input.language !== "string" ||
    (input.regionCode !== undefined && typeof input.regionCode !== "string") ||
    !["DESKTOP", "MOBILE"].includes(String(input.device)) ||
    ![30, 50, 100].includes(Number(input.depth)) ||
    typeof input.safeSearch !== "boolean" ||
    input.format !== "SIMPLE" ||
    input.rawSerp !== false ||
    input.fallbackMode !== "NONE" ||
    typeof input.providerMappingVersion !== "string" ||
    ![
      "EXACT_HOST",
      "INCLUDE_WWW",
      "INCLUDE_SUBDOMAINS",
      "CANONICAL_DOMAIN",
      "ANY_PROJECT_MIRROR",
      "SPECIFIC_URL",
      "URL_PREFIX"
    ].includes(mode) ||
    ((mode === "SPECIFIC_URL" || mode === "URL_PREFIX") &&
      typeof rule.value !== "string") ||
    (!(mode === "SPECIFIC_URL" || mode === "URL_PREFIX") &&
      rule.value !== undefined)
  ) invalid();
  return {
    searchEngine: input.searchEngine as "GOOGLE" | "YANDEX",
    countryCode: input.countryCode,
    ...(typeof input.regionCode === "string"
      ? { regionCode: input.regionCode }
      : {}),
    language: input.language,
    device: input.device as "DESKTOP" | "MOBILE",
    depth: input.depth as 30 | 50 | 100,
    domainMatchRule:
      mode === "SPECIFIC_URL" || mode === "URL_PREFIX"
        ? { mode, value: rule.value as string }
        : {
            mode: mode as Exclude<
              InternalRankExecutionParameters["domainMatchRule"]["mode"],
              "SPECIFIC_URL" | "URL_PREFIX"
            >
          },
    safeSearch: input.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: input.providerMappingVersion
  };
}

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input);
  if (
    required.some((key) => !Object.hasOwn(input, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) invalid();
  return input;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value;
}

function member<const Values extends readonly string[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) invalid();
  return Number(value);
}

function optionalInteger<Key extends string>(
  value: unknown,
  key: Key,
  minimum = 1
): Partial<Record<Key, number>> {
  return value === undefined ? {} : { [key]: integer(value, minimum) } as Partial<Record<Key, number>>;
}

function optionalBoundedString<Key extends string>(
  value: unknown,
  key: Key,
  maximum: number
): Partial<Record<Key, string>> {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.length > maximum) invalid();
  return { [key]: value } as Partial<Record<Key, string>>;
}

function safeUrl(value: string): string {
  if (!URL.canParse(value)) invalid();
  return value;
}

function safeUrlArray(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value.map((item) => {
    if (typeof item !== "string") invalid();
    return safeUrl(item);
  });
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data service returned an invalid operation result",
    retryable: true
  });
}

void operationResultItemStatuses;
