import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  domainEventTypes,
  semanticImportTargets,
  type SemanticImportColumnPreview,
  type SemanticImportDelimiter,
  type SemanticImportEncoding,
  type SemanticImportHeaderMode,
  type SemanticImportMapping
} from "@seo-platform/contracts";
import {
  Prisma,
  type SemanticImport
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort
} from "../storage/object-storage.port.js";
import {
  DelimitedParseError,
  type DetectedImportDelimiter,
  type DetectedImportEncoding,
  delimiterCharacter,
  detectDelimiter,
  importHeaders,
  parseDelimitedText,
  prepareDelimitedText,
  resolveHeaderMode,
  suggestColumnMapping
} from "./delimited-parser.js";
import {
  KC4_NATIVE_INTERNAL_HEADERS,
  parseKc4Rows
} from "./kc4-parser.js";
import { parseXlsxRows } from "./xlsx-parser.js";

const TERMINAL_PARSE_CODES = new Set([
  "BINARY_TEXT_FILE",
  "EMPTY_IMPORT",
  "FIELD_TOO_LARGE",
  "INVALID_KC4",
  "INVALID_XLSX",
  "INVALID_TEXT_ENCODING",
  "INVALID_QUOTE",
  "ROW_TOO_LARGE",
  "TOO_MANY_COLUMNS",
  "UNSUPPORTED_IMPORT_FORMAT",
  "UNTERMINATED_QUOTE",
  "KC4_ARCHIVE_TOO_LARGE",
  "KC4_TOO_MANY_GROUPS",
  "KC4_TOO_LARGE",
  "XLSX_ARCHIVE_TOO_LARGE",
  "XLSX_SHARED_STRINGS_TOO_LARGE",
  "XLSX_TOO_LARGE"
]);

export interface SemanticImportParseOutcome {
  readonly importId: string;
  readonly status: "AWAITING_MAPPING" | "VALIDATING" | "FAILED" | "SKIPPED";
  readonly code?: string;
  readonly version?: number;
}

interface StagingRow {
  readonly importId: string;
  readonly rowNumber: bigint;
  readonly rawValues: readonly string[];
  readonly issues: readonly string[];
  readonly fingerprint: string;
}

export function automaticKc4Mapping(
  columns: readonly SemanticImportColumnPreview[]
): SemanticImportMapping {
  const assignedTargets = new Set<string>();
  const customNames = new Set<string>();
  return {
    columns: columns.map((column) => {
      const suggested = semanticImportTargets.includes(
        column.suggestedTarget as (typeof semanticImportTargets)[number]
      )
        ? column.suggestedTarget as (typeof semanticImportTargets)[number]
        : "custom";
      const singleton = !["custom", "ignore"].includes(suggested);
      const target = suggested === "ignore" || (
        singleton && assignedTargets.has(suggested)
      )
        ? "custom"
        : suggested;
      if (singleton && target !== "custom") assignedTargets.add(target);
      return {
        sourceIndex: column.index,
        target,
        ...(target === "custom"
          ? { customName: uniqueKc4CustomName(column.sourceName, customNames) }
          : {})
      };
    }),
    defaultLanguage: "ru",
    groupSeparator: "/",
    duplicatePolicy: "OVERWRITE_MAPPED",
    createMissingKeywords: true
  };
}

function uniqueKc4CustomName(sourceName: string, used: Set<string>): string {
  const normalized = sourceName.normalize("NFKC").trim() || "Key Collector · Поле";
  let sequence = 1;
  while (true) {
    const suffix = sequence === 1 ? "" : ` (${sequence})`;
    const name = `${normalized.slice(0, 160 - suffix.length)}${suffix}`;
    const key = name.toLocaleLowerCase("ru-RU");
    if (!used.has(key)) {
      used.add(key);
      return name;
    }
    sequence += 1;
  }
}

@Injectable()
export class SemanticImportParserService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async pendingImportIds(limit = 100): Promise<readonly string[]> {
    const staleBefore = this.staleBefore();
    const imports = await this.prisma.semanticImport.findMany({
      where: {
        OR: [
          { status: "QUEUED" },
          {
            status: "PARSING",
            OR: [
              { parsingHeartbeatAt: { lt: staleBefore } },
              {
                parsingHeartbeatAt: null,
                OR: [
                  { parsingStartedAt: { lt: staleBefore } },
                  { parsingStartedAt: null }
                ]
              }
            ]
          }
        ]
      },
      orderBy: { createdAt: "asc" },
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true }
    });
    return imports.map(({ id }) => id);
  }

  public async parse(
    importId: string
  ): Promise<SemanticImportParseOutcome> {
    const claimedAt = new Date();
    const claimed = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        OR: [
          { status: "QUEUED" },
          {
            status: "PARSING",
            OR: [
              { parsingHeartbeatAt: { lt: this.staleBefore() } },
              {
                parsingHeartbeatAt: null,
                OR: [
                  {
                    parsingStartedAt: { lt: this.staleBefore() }
                  },
                  { parsingStartedAt: null }
                ]
              }
            ]
          }
        ]
      },
      data: {
        status: "PARSING",
        stage: "detecting_format",
        progressBytes: 0,
        failure: Prisma.DbNull,
        sourceMetadata: Prisma.DbNull,
        parsingStartedAt: claimedAt,
        parsingHeartbeatAt: claimedAt,
        parsingCompletedAt: null,
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
      return await this.parseClaimed(semanticImport, claimedAt);
    } catch (error) {
      const code = terminalParseCode(error);
      if (code) {
        return await this.fail(semanticImport, claimedAt, code);
      }
      await this.releaseForRetry(semanticImport.id, claimedAt);
      throw error;
    }
  }

  private async parseClaimed(
    semanticImport: SemanticImport,
    claimedAt: Date
  ): Promise<SemanticImportParseOutcome> {
    if (!this.storage.isEnabled()) {
      throw new Error("Object storage is disabled");
    }
    if (!["CSV", "TSV", "XLSX", "KC4"].includes(semanticImport.sourceFormat)) {
      throw new DelimitedParseError("UNSUPPORTED_IMPORT_FORMAT");
    }
    const upload = await this.prisma.upload.findFirst({
      where: {
        id: semanticImport.uploadId,
        workspaceId: semanticImport.workspaceId,
        projectId: semanticImport.projectId,
        status: "READY"
      }
    });
    if (!upload) throw new Error("Ready import upload is unavailable");

    await this.prisma.semanticImportStagingRow.deleteMany({
      where: { importId: semanticImport.id }
    });
    const objectSource = await this.storage.getObjectStream(
      "uploads",
      upload.objectKey
    );
    const observed = observeBytes(objectSource);
    let detectedEncoding: DetectedImportEncoding | undefined;
    let detectedDelimiter: DetectedImportDelimiter | undefined;
    let sourceMetadata: ParseResult["sourceMetadata"];
    let rowSource: AsyncIterable<readonly string[]>;
    if (semanticImport.sourceFormat === "XLSX") {
      rowSource = parseXlsxRows(
        observed.stream,
        semanticImport.totalBytes
      );
    } else if (semanticImport.sourceFormat === "KC4") {
      rowSource = parseKc4Rows(
        observed.stream,
        semanticImport.totalBytes,
        (metadata) => {
          sourceMetadata = {
            groupPaths: metadata.groupPaths,
            groups: metadata.groups
          };
        },
        (progress) => this.kc4Heartbeat(
          semanticImport.id,
          claimedAt,
          progress.stage,
          progress.compressedBytes ?? observed.bytes()
        )
      );
    } else {
      const prepared = await prepareDelimitedText(
        observed.stream,
        requestedEncoding(semanticImport.requestedEncoding)
      );
      detectedEncoding = prepared.encoding;
      const fallbackDelimiter =
        semanticImport.sourceFormat === "TSV" ? "TAB" : "COMMA";
      detectedDelimiter = detectDelimiter(
        prepared.sampleText,
        requestedDelimiter(semanticImport.requestedDelimiter),
        fallbackDelimiter
      );
      rowSource = parseDelimitedText(
        prepared.text,
        delimiterCharacter(detectedDelimiter)
      );
    }
    const rows = rowSource[Symbol.asyncIterator]();
    const initialRows: (readonly string[])[] = [];
    while (initialRows.length < 2) {
      const next = await rows.next();
      if (next.done) break;
      initialRows.push(next.value);
    }
    if (initialRows.length === 0) {
      throw new DelimitedParseError("EMPTY_IMPORT");
    }
    const resolvedHeaderMode =
      semanticImport.sourceFormat === "KC4"
        ? "PRESENT"
        : resolveHeaderMode(
            initialRows,
            requestedHeaderMode(semanticImport.headerMode)
          );
    const headers = [
      ...importHeaders(initialRows[0], resolvedHeaderMode)
    ];
    if (headers.length === 0) {
      throw new DelimitedParseError("EMPTY_IMPORT");
    }
    const previewLimit = Math.min(this.config.imports.previewRows, 100);
    const stagingBatchLimit = Math.min(
      this.config.imports.stagingBatchRows,
      5_000
    );
    const sampleRows: string[][] = [];
    const batch: StagingRow[] = [];
    let totalRows = 0n;
    let validRows = 0n;
    let warningRows = 0n;
    let errorRows = 0n;
    let sourceRowNumber = 0n;
    let lastHeartbeatAt = Date.now();

    const stageRow = async (values: readonly string[]): Promise<void> => {
      sourceRowNumber += 1n;
      if (
        resolvedHeaderMode === "PRESENT" &&
        sourceRowNumber === 1n
      ) {
        return;
      }
      if (values.every((value) => value.trim() === "")) return;
      while (headers.length < values.length) {
        headers.push(`Column ${headers.length + 1}`);
      }
      totalRows += 1n;
      const issues =
        values.length === headers.length
          ? []
          : ["COLUMN_COUNT_MISMATCH"];
      validRows += 1n;
      if (issues.length > 0) warningRows += 1n;
      if (sampleRows.length < previewLimit) {
        sampleRows.push([...values]);
      }
      batch.push({
        importId: semanticImport.id,
        rowNumber: sourceRowNumber,
        rawValues: values,
        issues,
        fingerprint: createHash("sha256")
          .update(JSON.stringify(values))
          .digest("hex")
      });
      if (batch.length >= stagingBatchLimit) {
        await this.flush(batch);
        if (
          Date.now() - lastHeartbeatAt >=
          this.config.imports.parseHeartbeatSeconds * 1_000
        ) {
          await this.heartbeat(
            semanticImport.id,
            claimedAt,
            observed.bytes(),
            totalRows
          );
          lastHeartbeatAt = Date.now();
        }
      }
    };

    for (const row of initialRows) await stageRow(row);
    while (true) {
      const next = await rows.next();
      if (next.done) break;
      await stageRow(next.value);
    }
    await this.flush(batch);
    if (totalRows === 0n) {
      throw new DelimitedParseError("EMPTY_IMPORT");
    }

    return this.complete(
      semanticImport,
      claimedAt,
      {
        ...(detectedEncoding ? { encoding: detectedEncoding } : {}),
        ...(detectedDelimiter ? { delimiter: detectedDelimiter } : {}),
        headerMode: resolvedHeaderMode,
        headers,
        suggestedMapping: suggestColumnMapping(headers).filter(
          ({ index }) => !KC4_NATIVE_INTERNAL_HEADERS.has(headers[index] ?? "")
        ),
        sampleRows,
        totalRows,
        validRows,
        warningRows,
        errorRows,
        progressBytes: observed.bytes(),
        ...(sourceMetadata ? { sourceMetadata } : {})
      }
    );
  }

  private async flush(batch: StagingRow[]): Promise<void> {
    if (batch.length === 0) return;
    const values = batch.splice(0, batch.length);
    await this.prisma.semanticImportStagingRow.createMany({
      data: values.map((row) => ({
        importId: row.importId,
        rowNumber: row.rowNumber,
        rawValues: [...row.rawValues],
        issues: [...row.issues],
        fingerprint: row.fingerprint
      })),
      skipDuplicates: true
    });
  }

  private async complete(
    semanticImport: SemanticImport,
    claimedAt: Date,
    result: ParseResult
  ): Promise<SemanticImportParseOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const automaticMapping = semanticImport.sourceFormat === "KC4"
        ? automaticKc4Mapping(result.suggestedMapping)
        : undefined;
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: semanticImport.id,
          status: "PARSING",
          parsingStartedAt: claimedAt
        },
        data: {
          status: automaticMapping ? "VALIDATING" : "AWAITING_MAPPING",
          stage: automaticMapping ? "validating_rows" : "mapping",
          detectedEncoding: result.encoding ?? null,
          detectedDelimiter: result.delimiter ?? null,
          headerMode: result.headerMode,
          headers: [...result.headers],
          sourceMetadata: result.sourceMetadata
            ? (result.sourceMetadata as Prisma.InputJsonValue)
            : Prisma.DbNull,
          suggestedMapping: result.suggestedMapping.map((column) => ({
            ...column
          })),
          confirmedMapping: automaticMapping
            ? (automaticMapping as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          validationSummary: Prisma.DbNull,
          validationStartedAt: null,
          validationHeartbeatAt: null,
          validationCompletedAt: null,
          sampleRows: result.sampleRows.map((row) => [...row]),
          totalRows: result.totalRows,
          validRows: result.validRows,
          warningRows: result.warningRows,
          errorRows: result.errorRows,
          progressBytes: result.progressBytes,
          parsingHeartbeatAt: completedAt,
          parsingCompletedAt: completedAt,
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
          eventType: domainEventTypes.semanticImportParsed,
          aggregateId: semanticImport.id,
          workspaceId: semanticImport.workspaceId,
          projectId: semanticImport.projectId,
          payload: {
            importId: semanticImport.id,
            uploadId: semanticImport.uploadId,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            totalRows: result.totalRows.toString(),
            warningRows: result.warningRows.toString(),
            errorRows: result.errorRows.toString()
          },
          metadata: {
            producer: "jobs-integrations",
            source: "semantic-import-worker"
          }
        }
      });
      return {
        importId: semanticImport.id,
        status: automaticMapping ? "VALIDATING" as const : "AWAITING_MAPPING" as const,
        ...(automaticMapping ? { version: semanticImport.version + 1 } : {})
      };
    });
  }

  private async fail(
    semanticImport: SemanticImport,
    claimedAt: Date,
    code: string
  ): Promise<SemanticImportParseOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: semanticImport.id,
          status: "PARSING",
          parsingStartedAt: claimedAt
        },
        data: {
          status: "FAILED",
          stage: "failed",
          failure: { code },
          parsingHeartbeatAt: completedAt,
          parsingCompletedAt: completedAt,
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
        status: "PARSING",
        parsingStartedAt: claimedAt
      },
      data: {
        status: "QUEUED",
        stage: "retry_pending",
        parsingStartedAt: null,
        parsingHeartbeatAt: null,
        failure: { code: "IMPORT_DEPENDENCY_UNAVAILABLE" },
        version: { increment: 1 }
      }
    });
  }

  private async heartbeat(
    importId: string,
    claimedAt: Date,
    progressBytes: bigint,
    processedRows: bigint
  ): Promise<void> {
    const updated = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "PARSING",
        parsingStartedAt: claimedAt
      },
      data: {
        stage: `parsing_rows:${processedRows}`,
        progressBytes,
        parsingHeartbeatAt: new Date()
      }
    });
    if (updated.count === 0) {
      throw new Error("Semantic import parsing lease was lost");
    }
  }

  private async kc4Heartbeat(
    importId: string,
    claimedAt: Date,
    stage: string,
    progressBytes: bigint
  ): Promise<void> {
    const updated = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "PARSING",
        parsingStartedAt: claimedAt
      },
      data: {
        stage,
        progressBytes,
        parsingHeartbeatAt: new Date()
      }
    });
    if (updated.count === 0) {
      throw new Error("Semantic import parsing lease was lost");
    }
  }

  private staleBefore(): Date {
    return new Date(
      Date.now() -
        this.config.imports.parseLeaseMinutes * 60 * 1_000
    );
  }
}

interface ParseResult {
  readonly encoding?: "UTF_8" | "WINDOWS_1251";
  readonly delimiter?: "COMMA" | "SEMICOLON" | "TAB";
  readonly headerMode: "PRESENT" | "ABSENT";
  readonly headers: readonly string[];
  readonly suggestedMapping: readonly SemanticImportColumnPreview[];
  readonly sampleRows: readonly (readonly string[])[];
  readonly totalRows: bigint;
  readonly validRows: bigint;
  readonly warningRows: bigint;
  readonly errorRows: bigint;
  readonly progressBytes: bigint;
  readonly sourceMetadata?: Readonly<{
    groupPaths: readonly (readonly string[])[];
    groups: readonly Readonly<{
      path: readonly string[];
      color?: string;
    }>[];
  }>;
}

function requestedEncoding(value: string): SemanticImportEncoding {
  return ["AUTO", "UTF_8", "WINDOWS_1251"].includes(value)
    ? (value as SemanticImportEncoding)
    : "AUTO";
}

function requestedDelimiter(value: string): SemanticImportDelimiter {
  return ["AUTO", "COMMA", "SEMICOLON", "TAB"].includes(value)
    ? (value as SemanticImportDelimiter)
    : "AUTO";
}

function requestedHeaderMode(value: string): SemanticImportHeaderMode {
  return ["AUTO", "PRESENT", "ABSENT"].includes(value)
    ? (value as SemanticImportHeaderMode)
    : "AUTO";
}

function observeBytes(source: AsyncIterable<Uint8Array>): {
  readonly stream: AsyncIterable<Uint8Array>;
  readonly bytes: () => bigint;
} {
  let bytes = 0n;
  async function* stream(): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      bytes += BigInt(chunk.byteLength);
      yield chunk;
    }
  }
  return { stream: stream(), bytes: () => bytes };
}

function terminalParseCode(error: unknown): string | undefined {
  if (
    error instanceof DelimitedParseError &&
    TERMINAL_PARSE_CODES.has(error.code)
  ) {
    return error.code;
  }
  return undefined;
}
