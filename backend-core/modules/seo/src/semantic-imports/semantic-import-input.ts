import { BadRequestException } from "@nestjs/common";
import {
  semanticImportDuplicatePolicies,
  semanticImportMaxGroupDepth,
  semanticImportMaxGroupManifestEntries,
  semanticImportNormalizeMaxRows,
  semanticImportPublishMaxRows,
  semanticKeywordIntents,
  type InternalApplySemanticImportChunkInput,
  type InternalAbortSemanticImportInput,
  type InternalBeginSemanticImportInput,
  type InternalCompleteSemanticImportInput,
  type InternalNormalizeSemanticKeywordsInput,
  type SemanticImportDuplicatePolicy,
  type SemanticImportFrequencyValue,
  type SemanticImportPositionValue,
  type SemanticImportRankHistoryValue,
  type SemanticImportSerpResultValue,
  type SemanticImportPublishRow
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { semanticCapacityEntitlement } from "../internal/semantic-capacity.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const INTEGER_PATTERN = /^(0|[1-9]\d*)$/u;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function normalizeSemanticKeywordsInput(
  value: unknown
): InternalNormalizeSemanticKeywordsInput {
  const input = record(value);
  const rows = array(input.rows, "rows");
  if (rows.length === 0 || rows.length > semanticImportNormalizeMaxRows) {
    invalid("rows");
  }
  const parsedRows = rows.map((row, index) => {
    const item = record(row);
    return {
      rowNumber: positiveBigintString(
        item.rowNumber,
        `rows.${index}.rowNumber`
      ),
      text: boundedString(item.text, `rows.${index}.text`, 1_000_000),
      language: language(item.language, `rows.${index}.language`)
    };
  });
  if (new Set(parsedRows.map(({ rowNumber }) => rowNumber)).size !== rows.length) {
    invalid("rows.rowNumber");
  }
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    rows: parsedRows
  };
}

export function beginSemanticImportInput(
  value: unknown
): InternalBeginSemanticImportInput {
  const input = record(value);
  const expectedChunks = positiveInteger(input.expectedChunks, "expectedChunks");
  if (expectedChunks > 1_000_000) invalid("expectedChunks");
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    mappingHash: hash(input.mappingHash, "mappingHash"),
    duplicatePolicy: duplicatePolicy(input.duplicatePolicy),
    // Default true keeps commands from a pre-deployment execution worker
    // compatible during a rolling production restart.
    createMissingKeywords: optionalBoolean(
      input.createMissingKeywords,
      true,
      "createMissingKeywords"
    ),
    expectedChunks,
    expectedUniqueRows: positiveBigintString(
      input.expectedUniqueRows,
      "expectedUniqueRows"
    ),
    expectedNewKeywords: bigintString(
      input.expectedNewKeywords,
      "expectedNewKeywords"
    ),
    entitlement: semanticCapacityEntitlement(input.entitlement)
  };
}

export function applySemanticImportChunkInput(
  value: unknown
): InternalApplySemanticImportChunkInput {
  const input = record(value);
  const rows = array(input.rows, "rows");
  if (rows.length === 0 || rows.length > semanticImportPublishMaxRows) {
    invalid("rows");
  }
  const parsedRows = rows.map((row, index) =>
    publishRow(row, `rows.${index}`)
  );
  const groupPaths =
    input.groupPaths === undefined
      ? undefined
      : array(input.groupPaths, "groupPaths").map((value, pathIndex) => {
          const path = array(value, `groupPaths.${pathIndex}`).map(
            (segment, segmentIndex) =>
              boundedString(
                segment,
                `groupPaths.${pathIndex}.${segmentIndex}`,
                255
              )
          );
          if (
            path.length < 1 ||
            path.length > semanticImportMaxGroupDepth
          ) {
            invalid("groupPaths");
          }
          return path;
        });
  if (groupPaths && groupPaths.length > semanticImportMaxGroupManifestEntries) invalid("groupPaths");
  const groupMetadata = input.groupMetadata === undefined
    ? undefined
    : array(input.groupMetadata, "groupMetadata").map((value, groupIndex) => {
        const item = record(value);
        const path = array(item.path, `groupMetadata.${groupIndex}.path`).map(
          (segment, segmentIndex) => boundedString(
            segment,
            `groupMetadata.${groupIndex}.path.${segmentIndex}`,
            255
          )
        );
        if (path.length < 1 || path.length > semanticImportMaxGroupDepth) invalid("groupMetadata");
        const color = item.color === undefined
          ? undefined
          : boundedString(item.color, `groupMetadata.${groupIndex}.color`, 7).toLowerCase();
        if (color !== undefined && !/^#[0-9a-f]{6}$/u.test(color)) invalid(`groupMetadata.${groupIndex}.color`);
        return { path, ...(color ? { color } : {}) };
      });
  if (groupMetadata && groupMetadata.length > semanticImportMaxGroupManifestEntries) invalid("groupMetadata");
  const keys = parsedRows.map(
    ({ language: rowLanguage, normalizedHash }) =>
      `${rowLanguage}\u0000${normalizedHash}`
  );
  if (new Set(keys).size !== keys.length) invalid("rows.normalizedHash");
  return {
    ...context(input),
    ...(input.projectDomain === undefined
      ? {}
      : { projectDomain: domain(input.projectDomain, "projectDomain") }),
    importId: uuid(input.importId, "importId"),
    chunkIndex: nonNegativeInteger(input.chunkIndex, "chunkIndex"),
    payloadHash: hash(input.payloadHash, "payloadHash"),
    duplicatePolicy: duplicatePolicy(input.duplicatePolicy),
    createMissingKeywords: optionalBoolean(
      input.createMissingKeywords,
      true,
      "createMissingKeywords"
    ),
    ...(groupPaths ? { groupPaths } : {}),
    ...(groupMetadata ? { groupMetadata } : {}),
    rows: parsedRows
  };
}

function domain(value: unknown, path: string): string {
  const normalized = boundedString(value, path, 253).toLowerCase();
  if (!DOMAIN_PATTERN.test(normalized)) invalid(path);
  return normalized;
}

function optionalBoolean(
  value: unknown,
  fallback: boolean,
  path: string
): boolean {
  if (value === undefined) return fallback;
  return boolean(value, path);
}

export function completeSemanticImportInput(
  value: unknown
): InternalCompleteSemanticImportInput {
  const input = record(value);
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    ...(input.partial === undefined
      ? {}
      : { partial: boolean(input.partial, "partial") })
  };
}

export function abortSemanticImportInput(
  value: unknown
): InternalAbortSemanticImportInput {
  const input = record(value);
  if (
    input.reason !== "CANCELLED" &&
    input.reason !== "FAILED_FINAL"
  ) {
    invalid("reason");
  }
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    reason: input.reason
  };
}

function publishRow(value: unknown, path: string): SemanticImportPublishRow {
  const input = record(value);
  const priority =
    input.priority === undefined
      ? undefined
      : nonNegativeInteger(input.priority, `${path}.priority`);
  if (priority !== undefined && priority > 100) {
    invalid(`${path}.priority`);
  }
  const isFavorite =
    input.isFavorite === undefined
      ? undefined
      : boolean(input.isFavorite, `${path}.isFavorite`);
  const isTracked =
    input.isTracked === undefined
      ? undefined
      : boolean(input.isTracked, `${path}.isTracked`);
  const note =
    input.note === undefined
      ? undefined
      : boundedString(input.note, `${path}.note`, 1_000_000);
  const intent =
    input.intent === undefined
      ? undefined
      : semanticKeywordIntents.find(
          (candidate) => candidate === input.intent
        );
  if (input.intent !== undefined && intent === undefined) {
    invalid(`${path}.intent`);
  }
  const groupPath =
    input.groupPath === undefined
      ? undefined
      : array(input.groupPath, `${path}.groupPath`).map((segment, index) =>
          boundedString(segment, `${path}.groupPath.${index}`, 255)
        );
  if (
    groupPath &&
    (groupPath.length === 0 ||
      groupPath.length > semanticImportMaxGroupDepth)
  ) {
    invalid(`${path}.groupPath`);
  }
  const groupPaths =
    input.groupPaths === undefined
      ? undefined
      : array(input.groupPaths, `${path}.groupPaths`).map(
          (value, groupIndex) => {
            const parsed = array(
              value,
              `${path}.groupPaths.${groupIndex}`
            ).map((segment, segmentIndex) =>
              boundedString(
                segment,
                `${path}.groupPaths.${groupIndex}.${segmentIndex}`,
                255
              )
            );
            if (
              parsed.length < 1 ||
              parsed.length > semanticImportMaxGroupDepth
            ) {
              invalid(`${path}.groupPaths.${groupIndex}`);
            }
            return parsed;
          }
        );
  if (groupPaths && groupPaths.length > 100) {
    invalid(`${path}.groupPaths`);
  }
  const targetUrl =
    input.targetUrl === undefined
      ? undefined
      : webUrl(input.targetUrl, `${path}.targetUrl`);
  const frequencies =
    input.frequencies === undefined
      ? undefined
      : array(input.frequencies, `${path}.frequencies`).map(
          (frequency, index) =>
            frequencyValue(frequency, `${path}.frequencies.${index}`)
        );
  const positions =
    input.positions === undefined
      ? undefined
      : array(input.positions, `${path}.positions`).map(
          (position, index) =>
            positionValue(position, `${path}.positions.${index}`)
        );
  if (
    positions &&
    (positions.length > 2 ||
      new Set(positions.map(({ searchEngine }) => searchEngine)).size !==
        positions.length)
  ) {
    invalid(`${path}.positions`);
  }
  const observedAt =
    input.observedAt === undefined
      ? undefined
      : isoDate(input.observedAt, `${path}.observedAt`);
  const positionHistory = input.positionHistory === undefined
    ? undefined
    : array(input.positionHistory, `${path}.positionHistory`).map((value, index) => historyPositionValue(value, `${path}.positionHistory.${index}`));
  if (positionHistory && (positionHistory.length > 1_100 || new Set(positionHistory.map(value => `${value.searchEngine}:${value.countryCode}:${value.regionCode}:${value.language}:${value.device}:${value.observedAt}`)).size !== positionHistory.length)) invalid(`${path}.positionHistory`);
  const tags =
    input.tags === undefined
      ? undefined
      : array(input.tags, `${path}.tags`).map((tag, index) =>
          boundedString(tag, `${path}.tags.${index}`, 160)
        );
  if (tags && tags.length > 100) invalid(`${path}.tags`);
  const customValues = stringRecord(input.customValues, `${path}.customValues`);
  return {
    sourceRowNumber: positiveBigintString(
      input.sourceRowNumber,
      `${path}.sourceRowNumber`
    ),
    textOriginal: boundedString(
      input.textOriginal,
      `${path}.textOriginal`,
      1_000_000
    ),
    textNormalized: boundedString(
      input.textNormalized,
      `${path}.textNormalized`,
      1_000_000
    ),
    normalizedHash: hash(
      input.normalizedHash,
      `${path}.normalizedHash`
    ),
    language: language(input.language, `${path}.language`),
    ...(priority === undefined ? {} : { priority }),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(note === undefined ? {} : { note }),
    ...(intent === undefined ? {} : { intent }),
    ...(groupPath ? { groupPath } : {}),
    ...(groupPaths ? { groupPaths } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    ...(frequencies ? { frequencies } : {}),
    ...(positions ? { positions } : {}),
    ...(positionHistory ? { positionHistory } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(tags ? { tags } : {}),
    customValues
  };
}

function historyPositionValue(value: unknown, path: string): SemanticImportRankHistoryValue {
  const input = record(value);
  if (Object.keys(input).some(key => !["source", "searchEngine", "countryCode", "regionCode", "regionLabel", "language", "device", "observedAt", "found", "position", "rankingUrl", "serpResults"].includes(key))) invalid(path);
  if (input.source !== undefined && input.source !== "KEY_COLLECTOR") invalid(`${path}.source`);
  if (input.searchEngine !== "YANDEX" && input.searchEngine !== "GOOGLE") invalid(`${path}.searchEngine`);
  const countryCode = boundedString(input.countryCode, `${path}.countryCode`, 2).toUpperCase();
  if (!/^[A-Z]{2}$/u.test(countryCode)) invalid(`${path}.countryCode`);
  const regionCode = boundedString(input.regionCode, `${path}.regionCode`, 100);
  const regionLabel = boundedString(input.regionLabel, `${path}.regionLabel`, 160);
  const lang = language(input.language, `${path}.language`);
  if (input.device !== "DESKTOP" && input.device !== "MOBILE") invalid(`${path}.device`);
  const date = isoDate(input.observedAt, `${path}.observedAt`);
  const found = boolean(input.found, `${path}.found`);
  const position = input.position === undefined ? undefined : positiveInteger(input.position, `${path}.position`);
  if ((found && (position === undefined || position > 100)) || (!found && position !== undefined)) invalid(`${path}.position`);
  const rankingUrl = input.rankingUrl === undefined
    ? undefined
    : webUrl(input.rankingUrl, `${path}.rankingUrl`);
  const serpResults = input.serpResults === undefined
    ? undefined
    : serpResultValues(input.serpResults, `${path}.serpResults`);
  return {
    ...(input.source === undefined ? {} : { source: "KEY_COLLECTOR" as const }),
    searchEngine: input.searchEngine,
    countryCode,
    regionCode,
    regionLabel,
    language: lang,
    device: input.device,
    observedAt: date,
    found,
    ...(position === undefined ? {} : { position }),
    ...(rankingUrl === undefined ? {} : { rankingUrl }),
    ...(serpResults === undefined ? {} : { serpResults })
  };
}

function positionValue(
  value: unknown,
  path: string
): SemanticImportPositionValue {
  const input = record(value);
  if (Object.keys(input).some((key) => ![
    "source",
    "searchEngine",
    "countryCode",
    "regionCode",
    "regionLabel",
    "language",
    "device",
    "observedAt",
    "found",
    "position",
    "previousPosition",
    "rankingUrl",
    "serpResults"
  ].includes(key))) {
    invalid(path);
  }
  if (input.searchEngine !== "YANDEX" && input.searchEngine !== "GOOGLE") {
    invalid(`${path}.searchEngine`);
  }
  const hasImportedContext = [
    input.source,
    input.countryCode,
    input.regionCode,
    input.regionLabel,
    input.language,
    input.device,
    input.observedAt
  ].some((candidate) => candidate !== undefined);
  let importedContext: Pick<
    SemanticImportPositionValue,
    "source" | "countryCode" | "regionCode" | "regionLabel" | "language" | "device" | "observedAt"
  > = {};
  if (hasImportedContext) {
    if (input.source !== "KEY_COLLECTOR") invalid(`${path}.source`);
    const countryCode = boundedString(
      input.countryCode,
      `${path}.countryCode`,
      2
    ).toUpperCase();
    if (!/^[A-Z]{2}$/u.test(countryCode)) invalid(`${path}.countryCode`);
    const regionCode = boundedString(
      input.regionCode,
      `${path}.regionCode`,
      100
    );
    const regionLabel = boundedString(
      input.regionLabel,
      `${path}.regionLabel`,
      160
    );
    const lang = language(input.language, `${path}.language`);
    if (input.device !== "DESKTOP" && input.device !== "MOBILE") {
      invalid(`${path}.device`);
    }
    const observedAt = input.observedAt === undefined
      ? undefined
      : isoDate(input.observedAt, `${path}.observedAt`);
    importedContext = {
      source: "KEY_COLLECTOR",
      countryCode,
      regionCode,
      regionLabel,
      language: lang,
      device: input.device,
      ...(observedAt === undefined ? {} : { observedAt })
    };
  }
  const found = boolean(input.found, `${path}.found`);
  const position =
    input.position === undefined
      ? undefined
      : positiveInteger(input.position, `${path}.position`);
  const previousPosition =
    input.previousPosition === undefined
      ? undefined
      : positiveInteger(input.previousPosition, `${path}.previousPosition`);
  if ((found && position === undefined) || (!found && position !== undefined)) {
    invalid(`${path}.position`);
  }
  const rankingUrl =
    input.rankingUrl === undefined
      ? undefined
      : webUrl(input.rankingUrl, `${path}.rankingUrl`);
  const serpResults = input.serpResults === undefined
    ? undefined
    : serpResultValues(input.serpResults, `${path}.serpResults`);
  return {
    ...importedContext,
    searchEngine: input.searchEngine,
    found,
    ...(position === undefined ? {} : { position }),
    ...(previousPosition === undefined ? {} : { previousPosition }),
    ...(rankingUrl === undefined ? {} : { rankingUrl }),
    ...(serpResults === undefined ? {} : { serpResults })
  };
}

function serpResultValues(
  value: unknown,
  path: string
): readonly SemanticImportSerpResultValue[] {
  const values = array(value, path);
  if (values.length > 100) invalid(path);
  const positions = new Set<number>();
  return values.map((value, index) => {
    const item = record(value);
    if (Object.keys(item).some((key) =>
      !["position", "rankingUrl", "title", "snippet"].includes(key)
    )) invalid(`${path}.${index}`);
    const position = positiveInteger(item.position, `${path}.${index}.position`);
    if (position > 100 || positions.has(position)) invalid(`${path}.${index}.position`);
    positions.add(position);
    return {
      position,
      rankingUrl: webUrl(item.rankingUrl, `${path}.${index}.rankingUrl`),
      ...(item.title === undefined
        ? {}
        : { title: boundedString(item.title, `${path}.${index}.title`, 8_000) }),
      ...(item.snippet === undefined
        ? {}
        : { snippet: boundedString(item.snippet, `${path}.${index}.snippet`, 32_000) })
    };
  });
}

function frequencyValue(
  value: unknown,
  path: string
): SemanticImportFrequencyValue {
  const input = record(value);
  if (!["BASE", "EXACT", "FIXED"].includes(String(input.type))) {
    invalid(`${path}.type`);
  }
  return {
    type: input.type as SemanticImportFrequencyValue["type"],
    value: bigintString(input.value, `${path}.value`)
  };
}

function context(
  input: Readonly<Record<string, unknown>>
): {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
} {
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function duplicatePolicy(value: unknown): SemanticImportDuplicatePolicy {
  if (
    typeof value !== "string" ||
    !semanticImportDuplicatePolicies.includes(
      value as SemanticImportDuplicatePolicy
    )
  ) {
    invalid("duplicatePolicy");
  }
  return value as SemanticImportDuplicatePolicy;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("A JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(path);
  return value;
}

function boundedString(value: unknown, path: string, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max
  ) {
    invalid(path);
  }
  return value.trim();
}

function integerString(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !INTEGER_PATTERN.test(value) ||
    BigInt(value) > POSTGRES_BIGINT_MAX
  ) {
    invalid(path);
  }
  return value;
}

function bigintString(value: unknown, path: string): string {
  return integerString(value, path);
}

function positiveBigintString(value: unknown, path: string): string {
  const result = integerString(value, path);
  if (result === "0") invalid(path);
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(path);
  return Number(value);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path);
  return Number(value);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) invalid(path);
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path);
  return internalUuid(value, path);
}

function language(value: unknown, path: string): string {
  const result = boundedString(value, path, 32);
  if (result !== "und" && !LANGUAGE_PATTERN.test(result)) invalid(path);
  return result;
}

function webUrl(value: unknown, path: string): string {
  const result = boundedString(value, path, 8_192);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    invalid(path);
  }
  if (!["http:", "https:"].includes(url.protocol)) invalid(path);
  return result;
}

function isoDate(value: unknown, path: string): string {
  const result = boundedString(value, path, 64);
  const date = new Date(result);
  if (Number.isNaN(date.getTime())) invalid(path);
  return date.toISOString();
}

function stringRecord(
  value: unknown,
  path: string
): Readonly<Record<string, string>> {
  const input = record(value);
  const entries = Object.entries(input);
  if (entries.length > 500) invalid(path);
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!key.trim() || key.length > 160 || typeof item !== "string") {
      invalid(path);
    }
    if (item.length > 1_000_000) invalid(`${path}.${key}`);
    result[key] = item;
  }
  return result;
}

function invalid(path: string): never {
  throw new BadRequestException(`Invalid field: ${path}`);
}
