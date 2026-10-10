import {
  competitorSerpOperationResultDepth,
  frequencySeasonalityPointLimit,
  normalizedRankDataQualityFlags,
  operationResultItemStatuses,
  rankCommandKeywordLimit,
  semanticFrequencyDevices,
  semanticFrequencyQualityFlags,
  semanticFrequencyTypes,
  technicalCrawlMaxUrlLimit,
  rankExecutionPurpose,
  type CrawlOperationResultRow,
  type AiAnswerOperationSourceSummary,
  type InternalAiAnswerOperationResult,
  type InternalCrawlOperationResultPage,
  type InternalFrequencyOperationResult,
  type InternalRankExecutionParameters,
  type InternalRankOperationResult,
  type RankOperationSerpResult,
  type RankOperationResultRow
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function scopedInternalAiAnswerOperationResult(
  value: unknown,
  workspaceId: string,
  projectId: string,
  jobId: string,
  expectedKeywordIds: readonly string[],
  includeSources: boolean
): InternalAiAnswerOperationResult {
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
    const row = exact(value, ["keywordId", "keyword"], ["snapshot"]);
    const keywordId = uuid(row.keywordId);
    if (
      !expectedKeywordIds.includes(keywordId) ||
      seen.has(keywordId) ||
      typeof row.keyword !== "string" ||
      row.keyword.length < 1 ||
      row.keyword.length > 2_000
    ) invalid();
    seen.add(keywordId);
    if (row.snapshot === undefined) {
      return { keywordId, keyword: row.keyword };
    }
    const snapshot = exact(
      row.snapshot,
      [
        "answerPresent",
        "siteFound",
        "brandFound",
        "sourceCount",
        "observedAt",
        ...(includeSources ? ["sources"] : [])
      ],
      ["position", "rankingUrl"]
    );
    if (
      typeof snapshot.answerPresent !== "boolean" ||
      typeof snapshot.siteFound !== "boolean" ||
      typeof snapshot.brandFound !== "boolean" ||
      (snapshot.position !== undefined &&
        (!Number.isSafeInteger(snapshot.position) || Number(snapshot.position) < 1)) ||
      (snapshot.rankingUrl !== undefined &&
        (typeof snapshot.rankingUrl !== "string" ||
          snapshot.rankingUrl.length > 20_000 ||
          !URL.canParse(snapshot.rankingUrl)))
    ) invalid();
    const sourceCount = integer(snapshot.sourceCount, 0, 100);
    const sources = includeSources
      ? aiAnswerSources(snapshot.sources)
      : undefined;
    if (sources && sources.length !== sourceCount) invalid();
    return {
      keywordId,
      keyword: row.keyword,
      snapshot: {
        answerPresent: snapshot.answerPresent,
        siteFound: snapshot.siteFound,
        ...(snapshot.position === undefined ? {} : { position: Number(snapshot.position) }),
        ...(snapshot.rankingUrl === undefined ? {} : { rankingUrl: snapshot.rankingUrl }),
        brandFound: snapshot.brandFound,
        sourceCount,
        ...(sources ? { sources } : {}),
        observedAt: timestamp(snapshot.observedAt)
      }
    };
  });
  if (seen.size !== expectedKeywordIds.length) invalid();
  return { workspaceId, projectId, jobId, rows };
}

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
    const row = exact(value, ["keywordId", "keyword", "snapshots", "seasonality"], ["keywordVersion", "keywordAvailable"]);
    const keywordId = uuid(row.keywordId);
    if (
      !expectedKeywordIds.includes(keywordId) ||
      seen.has(keywordId) ||
      typeof row.keyword !== "string" ||
      (row.keyword.length < 1 && row.keywordAvailable !== false) ||
      (row.keywordAvailable !== undefined && typeof row.keywordAvailable !== "boolean") ||
      row.keyword.length > 2_000 ||
      !Array.isArray(row.snapshots) ||
      row.snapshots.length > 3 ||
      !Array.isArray(row.seasonality) ||
      row.seasonality.length > frequencySeasonalityPointLimit
    ) invalid();
    seen.add(keywordId);
    const types = new Set<string>();
    return {
      keywordId,
      keyword: row.keyword,
      ...(row.keywordVersion === undefined ? {} : { keywordVersion: integer(row.keywordVersion, 1, 2_147_483_647) }),
      ...(row.keywordAvailable === undefined ? {} : { keywordAvailable: row.keywordAvailable as boolean }),
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
      }),
      seasonality: row.seasonality.map((value) => {
        const point = exact(value, [
          "type", "granularity", "periodStart", "value", "regionCode", "device",
          "provider", "sourceMode", "jobId", "observedAt"
        ], ["share"]);
        if (
          !["BASE", "EXACT", "FIXED"].includes(String(point.type)) ||
          !["MONTH", "WEEK", "DAY"].includes(String(point.granularity)) ||
          typeof point.periodStart !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/u.test(point.periodStart) ||
          new Date(`${point.periodStart}T00:00:00.000Z`).toISOString().slice(0, 10) !== point.periodStart ||
          typeof point.value !== "string" ||
          !/^(?:0|[1-9]\d{0,18})$/u.test(point.value) ||
          (point.share !== undefined &&
            (typeof point.share !== "string" ||
              !/^(?:0(?:\.\d{1,18})?|1(?:\.0{1,18})?)$/u.test(point.share))) ||
          typeof point.regionCode !== "string" ||
          point.regionCode.length < 1 ||
          point.regionCode.length > 100 ||
          (point.provider !== "XMLSTOCK" && point.provider !== "ARSENKIN") ||
          (point.sourceMode !== "BYOK" && point.sourceMode !== "PLATFORM") ||
          point.jobId !== jobId
        ) invalid();
        return {
          type: point.type as "BASE" | "EXACT" | "FIXED",
          granularity: point.granularity as "MONTH" | "WEEK" | "DAY",
          periodStart: point.periodStart,
          value: point.value,
          ...(typeof point.share === "string" ? { share: point.share } : {}),
          regionCode: point.regionCode,
          device: member(point.device, semanticFrequencyDevices),
          provider: member(point.provider, ["XMLSTOCK", "ARSENKIN"] as const),
          sourceMode: member(point.sourceMode, ["BYOK", "PLATFORM"] as const),
          jobId,
          observedAt: timestamp(point.observedAt)
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
  jobId: string,
  limit: number,
  cursor?: string
): InternalRankOperationResult {
  const input = exact(value, [
    "workspaceId",
    "projectId",
    "jobId",
    "trackingContextId",
    "contextName",
    "execution",
    "counts",
    "rows",
    "page"
  ]);
  const page = exact(input.page, ["hasNext"], ["nextCursor"]);
  const counts = exact(input.counts, ["foundCount", "notFoundCount"]);
  const execution = rankExecution(input.execution);
  const competitorCollection =
    rankExecutionPurpose(execution) === "COMPETITOR_SERP";
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    input.jobId !== jobId ||
    typeof input.contextName !== "string" ||
    input.contextName.length < 1 ||
    input.contextName.length > 160 ||
    !Number.isSafeInteger(counts.foundCount) ||
    Number(counts.foundCount) < 0 ||
    !Number.isSafeInteger(counts.notFoundCount) ||
    Number(counts.notFoundCount) < 0 ||
    Number(counts.foundCount) + Number(counts.notFoundCount) >
      rankCommandKeywordLimit ||
    !Array.isArray(input.rows) ||
    input.rows.length > limit ||
    typeof page.hasNext !== "boolean" ||
    (page.hasNext &&
      (typeof page.nextCursor !== "string" || input.rows.length !== limit)) ||
    (!page.hasNext && page.nextCursor !== undefined)
  ) invalid();
  const keywordIds = new Set<string>();
  const sequences = new Set<number>();
  const rows = input.rows.map((value): RankOperationResultRow => {
    const row = exact(
      value,
      ["sequence", "keywordId", "keyword", "state", "dataQualityFlags"],
      [
        "keywordVersion",
        "keywordAvailable",
        "position",
        "absolutePosition",
        "pixelPosition",
        "rankingUrl",
        "title",
        "snippet",
        "observedAt",
        ...(competitorCollection ? ["serpResults"] : [])
      ]
    );
    const keywordId = uuid(row.keywordId);
    const sequence = integer(
      row.sequence,
      0,
      rankCommandKeywordLimit - 1
    );
    const keywordUnavailable = row.keywordAvailable === false;
    if (
      keywordIds.has(keywordId) ||
      sequences.has(sequence) ||
      typeof row.keyword !== "string" ||
      (!keywordUnavailable && row.keyword.length < 1) ||
      row.keyword.length > 2_000 ||
      !["PENDING", "FOUND", "NOT_FOUND"].includes(String(row.state)) ||
      !Array.isArray(row.dataQualityFlags) ||
      row.dataQualityFlags.length > normalizedRankDataQualityFlags.length
    ) invalid();
    keywordIds.add(keywordId);
    sequences.add(sequence);
    if (row.keywordAvailable !== undefined && typeof row.keywordAvailable !== "boolean") invalid();
    const editableKeyword = {
      ...(row.keywordAvailable === undefined ? {} : { keywordAvailable: row.keywordAvailable as boolean }),
      ...(row.keywordVersion === undefined ? {} : { keywordVersion: integer(row.keywordVersion, 1, Number.MAX_SAFE_INTEGER) })
    };
    const dataQualityFlags = row.dataQualityFlags.map((flag) =>
      member(flag, normalizedRankDataQualityFlags)
    );
    if (new Set(dataQualityFlags).size !== dataQualityFlags.length) invalid();
    if (competitorCollection && row.serpResults === undefined) invalid();
    const serpResults = competitorCollection
      ? rankOperationSerpResults(row.serpResults)
      : undefined;
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
        ...editableKeyword,
        position: integer(row.position, 1, 100),
        ...optionalInteger(row.absolutePosition, "absolutePosition"),
        ...optionalInteger(row.pixelPosition, "pixelPosition", 0),
        rankingUrl: row.rankingUrl,
        ...optionalBoundedString(row.title, "title", 10_000),
        ...optionalBoundedString(row.snippet, "snippet", 20_000),
        observedAt: timestamp(row.observedAt),
        ...(serpResults ? { serpResults } : {}),
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
      ...editableKeyword,
      ...(row.state === "NOT_FOUND"
        ? { observedAt: timestamp(row.observedAt) }
        : {}),
      ...(serpResults ? { serpResults } : {}),
      dataQualityFlags
    };
  });
  const firstSequence = cursor === undefined ? 0 : Number(cursor) + 1;
  if (
    rows.some((row, index) => row.sequence !== firstSequence + index) ||
    (page.hasNext && page.nextCursor !== String(rows.at(-1)?.sequence))
  ) invalid();
  return {
    workspaceId,
    projectId,
    jobId,
    trackingContextId: uuid(input.trackingContextId),
    contextName: input.contextName,
    execution,
    counts: {
      foundCount: Number(counts.foundCount),
      notFoundCount: Number(counts.notFoundCount)
    },
    rows,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {})
    }
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
    const sequence = integer(row.sequence, 1, technicalCrawlMaxUrlLimit);
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
      statusCode: integer(row.statusCode, row.indexability === "BLOCKED_ROBOTS" ? 0 : 100, 599),
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
  ], ["regionCode", "purpose", "saveProjectPosition"]);
  const rule = exact(input.domainMatchRule, ["mode"], ["value"]);
  const mode = String(rule.mode);
  const purpose = input.purpose;
  const saveProjectPosition = input.saveProjectPosition;
  if (
    (purpose !== undefined &&
      purpose !== "POSITION_TRACKING" &&
      purpose !== "COMPETITOR_SERP") ||
    (saveProjectPosition !== undefined &&
      typeof saveProjectPosition !== "boolean") ||
    !["GOOGLE", "YANDEX"].includes(String(input.searchEngine)) ||
    typeof input.countryCode !== "string" ||
    typeof input.language !== "string" ||
    (input.regionCode !== undefined && typeof input.regionCode !== "string") ||
    !["DESKTOP", "MOBILE"].includes(String(input.device)) ||
    ![10, 20, 30, 50, 100].includes(Number(input.depth)) ||
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
    ...(purpose === undefined ? {} : { purpose }),
    ...(saveProjectPosition === undefined ? {} : { saveProjectPosition }),
    searchEngine: input.searchEngine as "GOOGLE" | "YANDEX",
    countryCode: input.countryCode,
    ...(typeof input.regionCode === "string"
      ? { regionCode: input.regionCode }
      : {}),
    language: input.language,
    device: input.device as "DESKTOP" | "MOBILE",
    depth: input.depth as 10 | 20 | 30 | 50 | 100,
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

function aiAnswerSources(
  value: unknown
): readonly AiAnswerOperationSourceSummary[] {
  if (!Array.isArray(value) || value.length > 100) invalid();
  let previousPosition = 0;
  return value.map((value) => {
    const source = exact(
      value,
      ["position", "url"],
      ["title", "description"]
    );
    const position = integer(source.position, 1, 100);
    if (position <= previousPosition || typeof source.url !== "string") {
      invalid();
    }
    previousPosition = position;
    return {
      position,
      url: safeHttpUrl(source.url),
      ...optionalBoundedString(source.title, "title", 10_000),
      ...optionalBoundedString(source.description, "description", 20_000)
    };
  });
}

function rankOperationSerpResults(
  value: unknown
): readonly RankOperationSerpResult[] {
  if (
    !Array.isArray(value) ||
    value.length > competitorSerpOperationResultDepth
  ) {
    invalid();
  }
  let previousPosition = 0;
  return value.map((value) => {
    const result = exact(
      value,
      ["position", "rankingUrl"],
      ["faviconUrl", "title", "snippet"]
    );
    const position = integer(
      result.position,
      1,
      competitorSerpOperationResultDepth
    );
    if (
      position <= previousPosition ||
      typeof result.rankingUrl !== "string" ||
      (result.faviconUrl !== undefined &&
        typeof result.faviconUrl !== "string")
    ) {
      invalid();
    }
    previousPosition = position;
    return {
      position,
      rankingUrl: safeHttpUrl(result.rankingUrl),
      ...(typeof result.faviconUrl === "string"
        ? { faviconUrl: safeHttpUrl(result.faviconUrl) }
        : {}),
      ...optionalBoundedString(result.title, "title", 10_000),
      ...optionalBoundedString(result.snippet, "snippet", 20_000)
    };
  });
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

function safeHttpUrl(value: string): string {
  if (!URL.canParse(value)) invalid();
  const parsed = new URL(value);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    invalid();
  }
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
