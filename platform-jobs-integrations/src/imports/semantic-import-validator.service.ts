import { Injectable, NotFoundException } from "@nestjs/common";
import {
  domainEventTypes,
  type SemanticImportMapping,
  type SemanticImportPublishRow,
  type SemanticImportValidationSummary
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
    if (!keywordColumn || keywordColumn.sourceIndex >= headers.length) {
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
        if (!keyword) issues.add("KEYWORD_REQUIRED");
        return { row, values, keyword, issues };
      });
      const normalizable = pending.filter(({ keyword }) => keyword);
      const normalized =
        normalizable.length === 0
          ? { rows: [] }
          : await this.seoData.normalizeKeywords({
              workspaceId: semanticImport.workspaceId,
              projectId: semanticImport.projectId,
              actorId: semanticImport.actorId,
              importId: semanticImport.id,
              rows: normalizable.map(({ row, keyword }) => ({
                rowNumber: row.rowNumber.toString(),
                text: keyword,
                language: mapping.defaultLanguage
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
              issues
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
    const stats = await validationStats(this.prisma, semanticImport.id);
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
  issues: Set<string>
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
    mapping.groupSeparator,
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
  const customValues: Record<string, string> = {};
  for (const column of mapping.columns) {
    const raw = values[column.sourceIndex]?.trim();
    if (!raw) continue;
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
    ...(groupPath?.length ? { groupPath } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    ...(frequencies.length > 0 ? { frequencies } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    customValues
  };
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
  if (segments.length > 10) {
    issues.add("GROUP_DEPTH_EXCEEDED");
    return segments.slice(0, 10);
  }
  return segments;
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
  readonly uniqueKeywordsToProcess: bigint;
}

async function validationStats(
  prisma: PrismaService,
  importId: string
): Promise<ValidationStats> {
  const rows = await prisma.$queryRaw<
    readonly {
      total_rows: bigint;
      valid_rows: bigint;
      warning_rows: bigint;
      error_rows: bigint;
      duplicate_rows_in_file: bigint;
      existing_keywords_in_project: bigint;
      unique_keywords_to_process: bigint;
    }[]
  >`
    SELECT
      COUNT(*)::bigint AS total_rows,
      COUNT(*) FILTER (WHERE "is_valid")::bigint AS valid_rows,
      COUNT(*) FILTER (
        WHERE "is_valid" AND jsonb_array_length("issues") > 0
      )::bigint AS warning_rows,
      COUNT(*) FILTER (WHERE NOT "is_valid")::bigint AS error_rows,
      (
        COUNT(*) FILTER (WHERE "is_valid") -
        COUNT(DISTINCT "normalized_hash") FILTER (WHERE "is_valid")
      )::bigint AS duplicate_rows_in_file,
      COUNT(DISTINCT "normalized_hash") FILTER (
        WHERE "is_valid" AND "project_duplicate"
      )::bigint AS existing_keywords_in_project,
      COUNT(DISTINCT "normalized_hash") FILTER (
        WHERE "is_valid"
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
