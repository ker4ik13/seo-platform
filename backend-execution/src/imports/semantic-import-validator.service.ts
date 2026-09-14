import { Injectable, NotFoundException } from "@nestjs/common";
import {
  domainEventTypes,
  semanticImportMaxGroupDepth,
  semanticKeywordIntents,
  type SemanticImportMapping,
  type SemanticImportPositionValue,
  type SemanticImportPublishRow,
  type SemanticImportValidationSummary
  , semanticPositionHistoryHeaderDate
} from "@seo-platform/contracts";
import {
  Prisma,
  type SemanticImport
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Inject } from "@nestjs/common";
import {
  SeoDataClient,
  SeoDataClientError
} from "../seo-data/seo-data.client.js";
import { PrismaService } from "../database/prisma.service.js";
import { safeMapping } from "./semantic-import.service.js";
import { importedPositionHistory, isPositionHistorySummary, positionHistoryDateColumns, positionHistoryMetadataHeader } from "./position-history-import.js";

const TERMINAL_VALIDATION_CODES = new Set([
  "IMPORT_MAPPING_INVALID",
  "SEO_DATA_VALIDATION_REJECTED"
]);

export interface SemanticImportValidationOutcome {
  readonly importId: string;
  readonly status: "AWAITING_CONFIRMATION" | "FAILED" | "SKIPPED";
  readonly code?: string;
}

interface ValidatedRow {
  readonly importId: string;
  readonly rowNumber: bigint;
  readonly normalizedHash?: string;
  readonly canonicalRow?: SemanticImportPublishRow;
  readonly issues: readonly string[];
  readonly isValid: boolean;
  readonly projectDuplicate: boolean;
}

@Injectable()
export class SemanticImportValidatorService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly seoData: SeoDataClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async pendingImports(
    limit = 100
  ): Promise<readonly { readonly id: string; readonly version: number }[]> {
    return this.prisma.semanticImport.findMany({
      where: {
        status: "VALIDATING",
        OR: [
          { validationStartedAt: null },
          { validationHeartbeatAt: { lt: this.staleBefore() } },
          {
            validationHeartbeatAt: null,
            validationStartedAt: { lt: this.staleBefore() }
          }
        ]
      },
      orderBy: { updatedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true, version: true }
    });
  }

  public async validate(
    importId: string
  ): Promise<SemanticImportValidationOutcome> {
    const claimedAt = new Date();
    const claimed = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "VALIDATING",
        OR: [
          { validationStartedAt: null },
          { validationHeartbeatAt: { lt: this.staleBefore() } },
          {
            validationHeartbeatAt: null,
            validationStartedAt: { lt: this.staleBefore() }
          }
        ]
      },
      data: {
        stage: "validating_rows",
        validationStartedAt: claimedAt,
        validationHeartbeatAt: claimedAt,
        validationCompletedAt: null,
        failure: Prisma.DbNull,
        version: { increment: 1 }
      }
    });
    if (claimed.count === 0) {
      const current = await this.prisma.semanticImport.findUnique({
        where: { id: importId },
        select: { status: true }
      });
      if (!current) throw new NotFoundException("Import not found");
      return { importId, status: "SKIPPED", code: current.status };
    }
    const semanticImport = await this.prisma.semanticImport.findUnique({
      where: { id: importId }
    });
    if (!semanticImport) throw new NotFoundException("Import not found");
    try {
      return await this.validateClaimed(semanticImport, claimedAt);
    } catch (error) {
      const code = validationFailureCode(error);
      if (code) return this.fail(semanticImport, claimedAt, code);
      await this.releaseForRetry(semanticImport.id, claimedAt);
      throw error;
    }
  }

  private async validateClaimed(
    semanticImport: SemanticImport,
    claimedAt: Date
  ): Promise<SemanticImportValidationOutcome> {
    const mapping = safeMapping(semanticImport.confirmedMapping);
    const headers = stringArray(semanticImport.headers);
    if (!mapping || !headers) {
      throw new SemanticImportValidationError("IMPORT_MAPPING_INVALID");
    }
    const keywordColumn = mapping.columns.find(
      ({ target }) => target === "keyword.text"
    );
    const languageColumn = mapping.columns.find(
      ({ target }) => target === "keyword.language"
    );
    if (!keywordColumn || keywordColumn.sourceIndex >= headers.length) {
      throw new SemanticImportValidationError("IMPORT_MAPPING_INVALID");
    }
    if (
      mapping.positionHistory &&
      mapping.positionHistory.layout !== "LONG" &&
      positionHistoryDateColumns(headers).length === 0
    ) {
      throw new SemanticImportValidationError("IMPORT_MAPPING_INVALID");
    }
    if (
      mapping.positionHistory?.layout === "LONG" &&
      (!mapping.columns.some(({ target }) => target === "metric.observed_at") ||
        !mapping.columns.some(({ target }) =>
          ["ranking.position", "ranking.yandex.position", "ranking.google.position"].includes(target)
        ))
    ) {
      throw new SemanticImportValidationError("IMPORT_MAPPING_INVALID");
    }
    await this.prisma.semanticImportValidatedRow.deleteMany({
      where: { importId: semanticImport.id }
    });
    const issueCounts = new Map<string, bigint>();
    let cursor: bigint | undefined;
    let lastHeartbeatAt = Date.now();
    const batchSize = Math.min(
      Math.max(this.config.imports.stagingBatchRows, 1),
      500
    );
    while (true) {
      const rows = await this.prisma.semanticImportStagingRow.findMany({
        where: { importId: semanticImport.id },
        orderBy: { rowNumber: "asc" },
        take: batchSize,
        ...(cursor !== undefined
          ? {
              cursor: {
                importId_rowNumber: {
                  importId: semanticImport.id,
                  rowNumber: cursor
                }
              },
              skip: 1
            }
          : {})
      });
      if (rows.length === 0) break;
      const pending = rows.map((row) => {
        const values = stringArray(row.rawValues) ?? [];
        const keyword = values[keywordColumn.sourceIndex]?.trim() ?? "";
        const issues = new Set(stringArray(row.issues) ?? []);
        const skipSummary = Boolean(mapping.positionHistory && isPositionHistorySummary(keyword));
        if (skipSummary) issues.add("POSITION_HISTORY_SUMMARY_SKIPPED");
        else if (!keyword) issues.add("KEYWORD_REQUIRED");
        const language = importLanguage(
          languageColumn
            ? values[languageColumn.sourceIndex]
            : undefined,
          mapping.defaultLanguage,
          issues
        );
        return { row, values, keyword, language, issues, skipSummary };
      });
      const normalizable = pending.filter(({ keyword, skipSummary }) => keyword && !skipSummary);
      const normalized =
        normalizable.length === 0
          ? { rows: [] }
          : await this.seoData.normalizeKeywords({
              workspaceId: semanticImport.workspaceId,
              projectId: semanticImport.projectId,
              actorId: semanticImport.actorId,
              importId: semanticImport.id,
              rows: normalizable.map(({ row, keyword, language }) => ({
                rowNumber: row.rowNumber.toString(),
                text: keyword,
                language
              }))
            });
      const normalizedByRow = new Map(
        normalized.rows.map((row) => [row.rowNumber, row])
      );
      const validated = pending.map(({ row, values, issues }) => {
        const keyword = normalizedByRow.get(row.rowNumber.toString());
        const canonicalRow = keyword
          ? canonicalImportRow(
              row.rowNumber,
              values,
              headers,
              mapping,
              keyword,
              issues,
              { sourceFormat: semanticImport.sourceFormat }
            )
          : undefined;
        for (const issue of issues) {
          issueCounts.set(issue, (issueCounts.get(issue) ?? 0n) + 1n);
        }
        return {
          importId: semanticImport.id,
          rowNumber: row.rowNumber,
          ...(keyword ? { normalizedHash: keyword.normalizedHash } : {}),
          ...(canonicalRow ? { canonicalRow } : {}),
          issues: [...issues],
          isValid: Boolean(canonicalRow),
          projectDuplicate: keyword?.existsInProject ?? false
        } satisfies ValidatedRow;
      });
      await this.prisma.semanticImportValidatedRow.createMany({
        data: validated.map((row) => ({
          importId: row.importId,
          rowNumber: row.rowNumber,
          ...(row.normalizedHash
            ? { normalizedHash: row.normalizedHash }
            : {}),
          canonicalRow: row.canonicalRow
            ? json(row.canonicalRow)
            : Prisma.DbNull,
          issues: json(row.issues),
          isValid: row.isValid,
          projectDuplicate: row.projectDuplicate
        })),
        skipDuplicates: true
      });
      cursor = rows.at(-1)!.rowNumber;
      if (
        Date.now() - lastHeartbeatAt >=
        this.config.imports.parseHeartbeatSeconds * 1_000
      ) {
        await this.heartbeat(semanticImport.id, claimedAt);
        lastHeartbeatAt = Date.now();
      }
    }
    const stats = await validationStats(
      this.prisma,
      semanticImport.id,
      mapping.createMissingKeywords
    );
    if (stats.totalRows !== semanticImport.totalRows) {
      throw new Error("Semantic import validation row count mismatch");
    }
    const summary: SemanticImportValidationSummary = {
      totalRows: stats.totalRows.toString(),
      validRows: stats.validRows.toString(),
      warningRows: stats.warningRows.toString(),
      errorRows: stats.errorRows.toString(),
      duplicateRowsInFile: stats.duplicateRowsInFile.toString(),
      existingKeywordsInProject: stats.existingKeywordsInProject.toString(),
      newKeywordsSkipped: stats.newKeywordsSkipped.toString(),
      uniqueKeywordsToProcess: stats.uniqueKeywordsToProcess.toString(),
      issueCounts: Object.fromEntries(
        [...issueCounts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([code, count]) => [code, count.toString()])
      )
    };
    return this.complete(semanticImport, claimedAt, summary);
  }

  private async complete(
    semanticImport: SemanticImport,
    claimedAt: Date,
    summary: SemanticImportValidationSummary
  ): Promise<SemanticImportValidationOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: semanticImport.id,
          status: "VALIDATING",
          validationStartedAt: claimedAt
        },
        data: {
          status: "AWAITING_CONFIRMATION",
          stage: "validation_ready",
          validationSummary: json(summary),
          validationHeartbeatAt: completedAt,
          validationCompletedAt: completedAt,
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) {
        return {
          importId: semanticImport.id,
          status: "SKIPPED" as const
        };
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.semanticImportValidated,
          aggregateId: semanticImport.id,
          workspaceId: semanticImport.workspaceId,
          projectId: semanticImport.projectId,
          payload: {
            importId: semanticImport.id,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            ...summary
          },
          metadata: {
            producer: "jobs-integrations",
            source: "semantic-import-worker"
          }
        }
      });
      return {
        importId: semanticImport.id,
        status: "AWAITING_CONFIRMATION" as const
      };
    });
  }

  private async fail(
    semanticImport: SemanticImport,
    claimedAt: Date,
    code: string
  ): Promise<SemanticImportValidationOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: semanticImport.id,
          status: "VALIDATING",
          validationStartedAt: claimedAt
        },
        data: {
          status: "FAILED",
          stage: "failed",
          failure: { code },
          validationHeartbeatAt: completedAt,
          validationCompletedAt: completedAt,
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) {
        return {
          importId: semanticImport.id,
          status: "SKIPPED" as const
        };
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.semanticImportFailed,
          aggregateId: semanticImport.id,
          workspaceId: semanticImport.workspaceId,
          projectId: semanticImport.projectId,
          payload: {
            importId: semanticImport.id,
            uploadId: semanticImport.uploadId,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            stage: "validation",
            code
          },
          metadata: {
            producer: "jobs-integrations",
            source: "semantic-import-worker"
          }
        }
      });
      return {
        importId: semanticImport.id,
        status: "FAILED" as const,
        code
      };
    });
  }

  private async releaseForRetry(
    importId: string,
    claimedAt: Date
  ): Promise<void> {
    await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "VALIDATING",
        validationStartedAt: claimedAt
      },
      data: {
        stage: "validation_retry_pending",
        validationStartedAt: null,
        validationHeartbeatAt: null,
        failure: { code: "IMPORT_DEPENDENCY_UNAVAILABLE" },
        version: { increment: 1 }
      }
    });
  }

  private async heartbeat(importId: string, claimedAt: Date): Promise<void> {
    const updated = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "VALIDATING",
        validationStartedAt: claimedAt
      },
      data: {
        validationHeartbeatAt: new Date(),
        stage: "validating_rows"
      }
    });
    if (updated.count === 0) {
      throw new Error("Semantic import validation lease was lost");
    }
  }

  private staleBefore(): Date {
    return new Date(
      Date.now() -
        this.config.imports.parseLeaseMinutes * 60 * 1_000
    );
  }
}

export function canonicalImportRow(
  rowNumber: bigint,
  values: readonly string[],
  headers: readonly string[],
  mapping: SemanticImportMapping,
  keyword: {
    readonly textOriginal: string;
    readonly textNormalized: string;
    readonly normalizedHash: string;
    readonly language: string;
  },
  issues: Set<string>,
  options: Readonly<{ sourceFormat?: string }> = {}
): SemanticImportPublishRow {
  const byTarget = new Map(
    mapping.columns.map((column) => [column.target, column])
  );
  const value = (target: string): string | undefined => {
    const column = byTarget.get(
      target as SemanticImportMapping["columns"][number]["target"]
    );
    return column ? values[column.sourceIndex]?.trim() : undefined;
  };
  const groupPath = splitGroupPath(
    value("group.path"),
    options.sourceFormat === "KC4" ? "/" : mapping.groupSeparator,
    issues
  );
  const targetUrl = validUrl(value("page.target_url"), issues);
  const frequencies = [
    frequency("BASE", value("frequency.base"), issues),
    frequency("EXACT", value("frequency.exact"), issues),
    frequency("FIXED", value("frequency.fixed"), issues)
  ].filter(
    (item): item is NonNullable<typeof item> => item !== undefined
  );
  const observedAt = validDate(value("metric.observed_at"), issues);
  const tags = splitTags(value("keyword.tags"));
  const priority = optionalPriority(value("keyword.priority"), issues);
  const isFavorite = optionalBoolean(
    value("keyword.favorite"),
    "INVALID_FAVORITE",
    issues
  );
  const isTracked = optionalBoolean(
    value("keyword.tracked"),
    "INVALID_TRACKED",
    issues
  );
  const note = importNote(
    value("keyword.note") ??
      (options.sourceFormat === "KC4" ? kc4KeywordNote(headers, values) : undefined),
    issues
  );
  const intent = optionalIntent(value("keyword.intent"), issues);
  const explicitPositions = mappedPositions(value, issues);
  const positions = mapping.positionHistory ? [] : explicitPositions.length > 0
    ? explicitPositions
    : options.sourceFormat === "KC4" && value("ranking.position")
      ? kc4Positions(headers, values, issues)
      : legacyMappedPosition(value, issues);
  const positionHistory = mapping.positionHistory
    ? importedPositionHistory(headers, values, mapping.positionHistory, issues, mapping)
    : [];
  const customValues: Record<string, string> = {};
  for (const column of mapping.columns) {
    const raw = values[column.sourceIndex]?.trim();
    if (!raw) continue;
    if (mapping.positionHistory && (semanticPositionHistoryHeaderDate(headers[column.sourceIndex] ?? "") || positionHistoryMetadataHeader(headers[column.sourceIndex] ?? ""))) continue;
    if (
      options.sourceFormat === "KC4" &&
      KC4_NATIVE_POSITION_HEADERS.has(headers[column.sourceIndex] ?? "")
    ) {
      continue;
    }
    if (column.target === "custom" && column.customName) {
      customValues[column.customName] = raw;
    } else if (column.target === "metric.kei") {
      customValues[headers[column.sourceIndex] ?? "KEI"] = raw;
    } else if (
      [
        "ranking.position",
        "context.search_engine",
        "context.region"
      ].includes(column.target)
    ) {
      customValues[
        `Imported: ${headers[column.sourceIndex] ?? column.target}`
      ] = raw;
      issues.add("TRACKING_CONTEXT_REQUIRED");
    }
  }
  return {
    sourceRowNumber: rowNumber.toString(),
    textOriginal: keyword.textOriginal,
    textNormalized: keyword.textNormalized,
    normalizedHash: keyword.normalizedHash,
    language: keyword.language,
    ...(priority === undefined ? {} : { priority }),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(note === undefined ? {} : { note }),
    ...(intent === undefined ? {} : { intent }),
    ...(groupPath?.length ? { groupPath } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    ...(frequencies.length > 0 ? { frequencies } : {}),
    ...(positions.length > 0 ? { positions } : {}),
    ...(positionHistory.length > 0 ? { positionHistory } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    customValues
  };
}

function kc4KeywordNote(
  headers: readonly string[],
  values: readonly string[]
): string | undefined {
  const comments = [
    "Key Collector · Комментарий 1",
    "Key Collector · Комментарий 2"
  ].flatMap((header) => {
    const index = headers.indexOf(header);
    const value = index < 0 ? undefined : values[index]?.trim();
    return value ? [value] : [];
  });
  return comments.length > 0 ? comments.join("\n\n") : undefined;
}

function importNote(
  value: string | undefined,
  issues: Set<string>
): string | undefined {
  if (!value?.trim()) return undefined;
  const note = value.normalize("NFC").trim();
  if (note.length > 1_000_000) {
    issues.add("INVALID_NOTE");
    return undefined;
  }
  return note;
}

function splitGroupPath(
  value: string | undefined,
  separator: string,
  issues: Set<string>
): readonly string[] | undefined {
  if (!value) return undefined;
  const segments = value
    .split(separator)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.length > semanticImportMaxGroupDepth) {
    issues.add("GROUP_DEPTH_EXCEEDED");
    return segments.slice(0, semanticImportMaxGroupDepth);
  }
  return segments;
}

type ImportValue = (target: string) => string | undefined;

function mappedPositions(
  value: ImportValue,
  issues: Set<string>
): readonly SemanticImportPositionValue[] {
  return (["YANDEX", "GOOGLE"] as const).flatMap((searchEngine) => {
    const prefix = `ranking.${searchEngine.toLowerCase()}`;
    const rawPosition = value(`${prefix}.position`);
    if (!rawPosition) return [];
    const position = importedPosition(rawPosition, issues);
    if (position === undefined) return [];
    const found = position > 0;
    const rawChange = value(`${prefix}.change`);
    const change = rawChange ? importedPositionChange(rawChange, issues) : undefined;
    const previousPosition = found && change !== undefined
      ? position - change
      : undefined;
    const rankingUrl = validRankingUrl(value(`${prefix}.url`), issues);
    return [{
      searchEngine,
      found,
      ...(found ? { position } : {}),
      ...(previousPosition !== undefined && previousPosition > 0
        ? { previousPosition }
        : {}),
      ...(rankingUrl ? { rankingUrl } : {})
    }];
  });
}

function legacyMappedPosition(
  value: ImportValue,
  issues: Set<string>
): readonly SemanticImportPositionValue[] {
  const rawPosition = value("ranking.position");
  if (!rawPosition) return [];
  const rawEngine = value("context.search_engine")?.trim().toUpperCase();
  const searchEngine = rawEngine?.includes("ЯНД") || rawEngine === "YANDEX"
    ? "YANDEX"
    : rawEngine?.includes("GOOGLE") || rawEngine?.includes("ГУГЛ")
      ? "GOOGLE"
      : undefined;
  if (!searchEngine) {
    issues.add("TRACKING_CONTEXT_REQUIRED");
    return [];
  }
  const position = importedPosition(rawPosition, issues);
  if (position === undefined) return [];
  return [{
    searchEngine,
    found: position > 0,
    ...(position > 0 ? { position } : {})
  }];
}

function importedPosition(
  value: string,
  issues: Set<string>
): number | undefined {
  const normalized = value.replace(/[\s\u00a0]+/gu, "");
  if (!/^-?\d+$/u.test(normalized)) {
    issues.add("INVALID_POSITION");
    return undefined;
  }
  const position = Number(normalized);
  if (!Number.isSafeInteger(position)) {
    issues.add("INVALID_POSITION");
    return undefined;
  }
  if (position <= 0 || position === 2_147_483_647) return 0;
  if (position > 100) {
    issues.add("INVALID_POSITION");
    return undefined;
  }
  return position;
}

function importedPositionChange(
  value: string,
  issues: Set<string>
): number | undefined {
  const normalized = value.replace(/[\s\u00a0]+/gu, "");
  if (!/^-?\d+$/u.test(normalized)) {
    issues.add("INVALID_POSITION_CHANGE");
    return undefined;
  }
  const change = Number(normalized);
  if (!Number.isSafeInteger(change)) {
    issues.add("INVALID_POSITION_CHANGE");
    return undefined;
  }
  return change;
}

function importLanguage(
  value: string | undefined,
  fallback: string,
  issues: Set<string>
): string {
  const candidate = value?.trim() || fallback;
  if (candidate === "und") return candidate;
  try {
    const canonical = Intl.getCanonicalLocales(candidate);
    if (canonical.length !== 1 || !canonical[0] || canonical[0].length > 16) {
      throw new Error();
    }
    return canonical[0];
  } catch {
    issues.add("INVALID_LANGUAGE");
    return fallback;
  }
}

function optionalPriority(
  value: string | undefined,
  issues: Set<string>
): number | undefined {
  if (!value) return undefined;
  const priority = Number(value.trim());
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 100) {
    issues.add("INVALID_PRIORITY");
    return undefined;
  }
  return priority;
}

function optionalBoolean(
  value: string | undefined,
  issue: string,
  issues: Set<string>
): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (["1", "true", "yes", "да", "истина", "избранное"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "нет", "ложь"].includes(normalized)) {
    return false;
  }
  issues.add(issue);
  return undefined;
}

function optionalIntent(
  value: string | undefined,
  issues: Set<string>
): SemanticImportPublishRow["intent"] | undefined {
  if (!value) return undefined;
  const aliases: Readonly<Record<string, SemanticImportPublishRow["intent"]>> = {
    informational: "INFORMATIONAL",
    информационный: "INFORMATIONAL",
    navigational: "NAVIGATIONAL",
    навигационный: "NAVIGATIONAL",
    commercial: "COMMERCIAL",
    коммерческий: "COMMERCIAL",
    transactional: "TRANSACTIONAL",
    транзакционный: "TRANSACTIONAL",
    local: "LOCAL",
    локальный: "LOCAL",
    mixed: "MIXED",
    смешанный: "MIXED"
  };
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  const intent = aliases[normalized] ?? value.trim().toUpperCase();
  if (!semanticKeywordIntents.some((candidate) => candidate === intent)) {
    issues.add("INVALID_INTENT");
    return undefined;
  }
  return intent as SemanticImportPublishRow["intent"];
}

const KC4_NATIVE_POSITION_HEADERS = new Set([
  "Яндекс · Позиция",
  "Яндекс · Изменение позиции",
  "Яндекс · URL выдачи",
  "Google · Позиция",
  "Google · Изменение позиции",
  "Google · URL выдачи"
]);

function kc4Positions(
  headers: readonly string[],
  values: readonly string[],
  issues: Set<string>
): readonly SemanticImportPositionValue[] {
  const byHeader = new Map(headers.map((header, index) => [header, index]));
  const value = (header: string): string | undefined => {
    const index = byHeader.get(header);
    return index === undefined ? undefined : values[index]?.trim();
  };
  return ([
    ["YANDEX", "Яндекс"],
    ["GOOGLE", "Google"]
  ] as const).flatMap(([searchEngine, label]) => {
    const rawPosition = value(`${label} · Позиция`);
    if (!rawPosition) return [];
    const parsedPosition = importedPosition(rawPosition, issues);
    if (parsedPosition === undefined) return [];
    const found = parsedPosition > 0;
    const rankingUrl = validRankingUrl(
      value(`${label} · URL выдачи`),
      issues
    );
    const rawChange = value(`${label} · Изменение позиции`);
    const change = rawChange
      ? importedPositionChange(rawChange, issues)
      : undefined;
    const previousPosition =
      found && Number.isSafeInteger(change)
        ? parsedPosition - Number(change)
        : undefined;
    return [{
      searchEngine,
      found,
      ...(found ? { position: parsedPosition } : {}),
      ...(previousPosition !== undefined && previousPosition > 0
        ? { previousPosition }
        : {}),
      ...(rankingUrl ? { rankingUrl } : {})
    }];
  });
}

function validRankingUrl(
  value: string | undefined,
  issues: Set<string>
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return value;
  } catch {
    issues.add("INVALID_RANKING_URL");
    return undefined;
  }
}

function validUrl(
  value: string | undefined,
  issues: Set<string>
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return value;
  } catch {
    issues.add("INVALID_TARGET_URL");
    return undefined;
  }
}

function frequency(
  type: "BASE" | "EXACT" | "FIXED",
  value: string | undefined,
  issues: Set<string>
): { readonly type: "BASE" | "EXACT" | "FIXED"; readonly value: string } | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/[\s\u00a0]+/gu, "");
  if (
    !/^(0|[1-9]\d*)$/u.test(normalized) ||
    BigInt(normalized) > 9_223_372_036_854_775_807n
  ) {
    issues.add("INVALID_FREQUENCY");
    return undefined;
  }
  return { type, value: normalized };
}

function validDate(
  value: string | undefined,
  issues: Set<string>
): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    issues.add("INVALID_OBSERVED_AT");
    return undefined;
  }
  return date.toISOString();
}

function splitTags(value: string | undefined): readonly string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[;,|]/u)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 100)
    )
  ];
}

interface ValidationStats {
  readonly totalRows: bigint;
  readonly validRows: bigint;
  readonly warningRows: bigint;
  readonly errorRows: bigint;
  readonly duplicateRowsInFile: bigint;
  readonly existingKeywordsInProject: bigint;
  readonly newKeywordsSkipped: bigint;
  readonly uniqueKeywordsToProcess: bigint;
}

async function validationStats(
  prisma: PrismaService,
  importId: string,
  createMissingKeywords: boolean
): Promise<ValidationStats> {
  const rows = await prisma.$queryRaw<
    readonly {
      total_rows: bigint;
      valid_rows: bigint;
      warning_rows: bigint;
      error_rows: bigint;
      duplicate_rows_in_file: bigint;
      existing_keywords_in_project: bigint;
      new_keywords_skipped: bigint;
      unique_keywords_to_process: bigint;
    }[]
  >`
    SELECT
      COUNT(*)::bigint AS total_rows,
      COUNT(*) FILTER (WHERE "is_valid")::bigint AS valid_rows,
      COUNT(*) FILTER (
        WHERE "is_valid" AND jsonb_array_length("issues") > 0
      )::bigint AS warning_rows,
      COUNT(*) FILTER (
        WHERE NOT "is_valid" AND NOT "issues" @> '["POSITION_HISTORY_SUMMARY_SKIPPED"]'::jsonb
      )::bigint AS error_rows,
      (
        COUNT(*) FILTER (WHERE "is_valid") -
        COUNT(DISTINCT "normalized_hash") FILTER (WHERE "is_valid")
      )::bigint AS duplicate_rows_in_file,
      COUNT(DISTINCT "normalized_hash") FILTER (
        WHERE "is_valid" AND "project_duplicate"
      )::bigint AS existing_keywords_in_project,
      COUNT(DISTINCT "normalized_hash") FILTER (
        WHERE
          "is_valid"
          AND NOT "project_duplicate"
          AND NOT ${createMissingKeywords}
      )::bigint AS new_keywords_skipped,
      COUNT(DISTINCT "normalized_hash") FILTER (
        WHERE
          "is_valid"
          AND (${createMissingKeywords} OR "project_duplicate")
      )::bigint AS unique_keywords_to_process
    FROM "semantic_import_validated_rows"
    WHERE "import_id" = ${importId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new Error("Semantic import validation stats unavailable");
  return {
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    warningRows: row.warning_rows,
    errorRows: row.error_rows,
    duplicateRowsInFile: row.duplicate_rows_in_file,
    existingKeywordsInProject: row.existing_keywords_in_project,
    newKeywordsSkipped: row.new_keywords_skipped,
    uniqueKeywordsToProcess: row.unique_keywords_to_process
  };
}

function validationFailureCode(error: unknown): string | undefined {
  if (
    error instanceof SemanticImportValidationError &&
    TERMINAL_VALIDATION_CODES.has(error.code)
  ) {
    return error.code;
  }
  if (error instanceof SeoDataClientError && !error.retryable) {
    return "SEO_DATA_VALIDATION_REJECTED";
  }
  return undefined;
}

class SemanticImportValidationError extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
