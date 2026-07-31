import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  domainEventTypes,
  semanticImportDuplicatePolicies,
  semanticImportDelimiters,
  semanticImportEncodings,
  semanticImportTargets,
  type InternalCancelSemanticImportInput,
  type InternalConfigureSemanticImportInput,
  type InternalConfirmSemanticImportInput,
  type InternalCreateSemanticImportInput,
  type SemanticImportColumnPreview,
  type SemanticImportDelimiter,
  type SemanticImportEncoding,
  type SemanticImportMapping,
  type SemanticImportResultSummary,
  type SemanticImportSummary
} from "@seo-platform/contracts";
import {
  Prisma,
  type SemanticImport
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";

const SUPPORTED_SOURCE_FORMATS: Readonly<Record<string, string>> = {
  "text/csv": "CSV",
  "text/tab-separated-values": "TSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX"
};

@Injectable()
export class SemanticImportService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService
  ) {}

  public async create(
    input: InternalCreateSemanticImportInput,
    requestId: string
  ): Promise<SemanticImportSummary> {
    const options = normalizedOptions(input);
    const existing = await this.findIdempotent(input);
    if (existing) {
      this.assertSameCommand(existing, input, options);
      if (existing.status === "QUEUED") {
        await this.enqueue(existing.id);
      }
      return toSemanticImportSummary(existing);
    }

    const upload = await this.prisma.upload.findFirst({
      where: {
        id: input.uploadId,
        workspaceId: input.workspaceId,
        projectId: input.projectId
      }
    });
    if (!upload) throw new NotFoundException("Upload not found");
    if (upload.status !== "READY") {
      throw new ConflictException(
        "Only a READY upload can be imported"
      );
    }
    const sourceFormat = SUPPORTED_SOURCE_FORMATS[upload.mediaType];
    if (!sourceFormat) {
      throw new UnprocessableEntityException(
        "This import format is not enabled yet"
      );
    }

    let created: SemanticImport;
    try {
      created = await this.prisma.$transaction(async (transaction) => {
        const semanticImport = await transaction.semanticImport.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            uploadId: upload.id,
            actorId: input.actorId,
            sourceFormat,
            requestedEncoding: options.encoding,
            requestedDelimiter: options.delimiter,
            headerMode: options.headerMode,
            totalBytes: upload.sizeBytes,
            idempotencyKey: input.idempotencyKey
          }
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: domainEventTypes.semanticImportCreated,
            aggregateId: semanticImport.id,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            payload: {
              importId: semanticImport.id,
              uploadId: semanticImport.uploadId,
              workspaceId: semanticImport.workspaceId,
              projectId: semanticImport.projectId,
              sourceFormat
            },
            metadata: {
              producer: "jobs-integrations",
              requestId
            }
          }
        });
        return semanticImport;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner = await this.findIdempotent(input);
        if (winner) {
          this.assertSameCommand(winner, input, options);
          await this.enqueue(winner.id);
          return toSemanticImportSummary(winner);
        }
      }
      throw error;
    }
    await this.enqueue(created.id);
    return toSemanticImportSummary(created);
  }

  public async get(
    importId: string,
    workspaceId: string,
    projectId: string
  ): Promise<SemanticImportSummary> {
    const semanticImport = await this.prisma.semanticImport.findFirst({
      where: { id: importId, workspaceId, projectId }
    });
    if (!semanticImport) throw new NotFoundException("Import not found");
    return toSemanticImportSummary(semanticImport);
  }

  public async configure(
    importId: string,
    input: InternalConfigureSemanticImportInput
  ): Promise<SemanticImportSummary> {
    const current = await this.requiredScoped(importId, input);
    if (!["AWAITING_MAPPING", "AWAITING_CONFIRMATION"].includes(current.status)) {
      throw new ConflictException(
        "Semantic import mapping cannot be changed in this state"
      );
    }
    const headers = safeHeaders(current.headers);
    if (!headers) {
      throw new ConflictException("Semantic import headers are unavailable");
    }
    if (
      input.columns.some(({ sourceIndex }) => sourceIndex >= headers.length)
    ) {
      throw new UnprocessableEntityException(
        "Semantic import mapping references an unknown column"
      );
    }
    const mapping: SemanticImportMapping = {
      columns: input.columns.map((column) => ({ ...column })),
      defaultLanguage: input.defaultLanguage,
      groupSeparator: input.groupSeparator,
      duplicatePolicy: input.duplicatePolicy
    };
    const updated = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        version: input.version,
        status: { in: ["AWAITING_MAPPING", "AWAITING_CONFIRMATION"] }
      },
      data: {
        status: "VALIDATING",
        stage: "validating_rows",
        confirmedMapping: json(mapping),
        validationSummary: Prisma.DbNull,
        resultSummary: Prisma.DbNull,
        validationStartedAt: null,
        validationHeartbeatAt: null,
        validationCompletedAt: null,
        publishingStartedAt: null,
        publishingHeartbeatAt: null,
        publishingCompletedAt: null,
        failure: Prisma.DbNull,
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) throw versionConflict();
    const semanticImport = await this.requiredScoped(importId, input);
    await this.enqueueValidation(semanticImport.id, semanticImport.version);
    return toSemanticImportSummary(semanticImport);
  }

  public async confirm(
    importId: string,
    input: InternalConfirmSemanticImportInput
  ): Promise<SemanticImportSummary> {
    const current = await this.requiredScoped(importId, input);
    if (current.status !== "AWAITING_CONFIRMATION") {
      throw new ConflictException(
        "Semantic import is not awaiting confirmation"
      );
    }
    const validation = safeValidation(current.validationSummary);
    if (!validation || BigInt(validation.uniqueKeywordsToProcess) === 0n) {
      throw new UnprocessableEntityException(
        "Semantic import has no valid keywords to publish"
      );
    }
    const updated = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        version: input.version,
        status: "AWAITING_CONFIRMATION"
      },
      data: {
        status: "READY_TO_PUBLISH",
        stage: "publish_queued",
        publishingStartedAt: null,
        publishingHeartbeatAt: null,
        publishingCompletedAt: null,
        billingPlanCode: input.entitlement.planCode,
        billingPlanVersion: input.entitlement.planVersion,
        storedKeywordsLimit: BigInt(
          input.entitlement.storedKeywords
        ),
        keywordsPerProjectLimit: BigInt(
          input.entitlement.keywordsPerProject
        ),
        trackedContextPairsLimit: BigInt(
          input.entitlement.trackedContextPairs
        ),
        failure: Prisma.DbNull,
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) throw versionConflict();
    const semanticImport = await this.requiredScoped(importId, input);
    await this.enqueuePublish(semanticImport.id, semanticImport.version);
    return toSemanticImportSummary(semanticImport);
  }

  public async cancel(
    importId: string,
    input: InternalCancelSemanticImportInput,
    requestId: string
  ): Promise<SemanticImportSummary> {
    const current = await this.requiredScoped(importId, input);
    if (current.status === "CANCELLED") {
      return toSemanticImportSummary(current);
    }
    if (current.status === "COMPLETED") {
      throw new ConflictException("Completed semantic import cannot be cancelled");
    }
    const requiresCooperativeStop = current.status === "PUBLISHING";
    const nextStatus = requiresCooperativeStop
      ? "CANCEL_REQUESTED"
      : "CANCELLED";
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: importId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: current.status
        },
        data: {
          status: nextStatus,
          stage: requiresCooperativeStop
            ? "cancel_requested"
            : "cancelled",
          cancelRequestedAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw versionConflict();
      const semanticImport = await transaction.semanticImport.findUniqueOrThrow({
        where: { id: importId }
      });
      if (nextStatus === "CANCELLED") {
        await transaction.outboxEvent.create({
          data: {
            eventType: domainEventTypes.semanticImportCancelled,
            aggregateId: semanticImport.id,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            payload: {
              importId: semanticImport.id,
              workspaceId: semanticImport.workspaceId,
              projectId: semanticImport.projectId
            },
            metadata: {
              producer: "jobs-integrations",
              requestId
            }
          }
        });
      }
      return semanticImport;
    });
    return toSemanticImportSummary(updated);
  }

  private findIdempotent(
    input: InternalCreateSemanticImportInput
  ): Promise<SemanticImport | null> {
    return this.prisma.semanticImport.findUnique({
      where: {
        workspaceId_actorId_idempotencyKey: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
  }

  private assertSameCommand(
    existing: SemanticImport,
    input: InternalCreateSemanticImportInput,
    options: NormalizedOptions
  ): void {
    if (
      existing.projectId !== input.projectId ||
      existing.uploadId !== input.uploadId ||
      existing.requestedEncoding !== options.encoding ||
      existing.requestedDelimiter !== options.delimiter ||
      existing.headerMode !== options.headerMode
    ) {
      throw new ConflictException(
        "Idempotency key was already used for another import"
      );
    }
  }

  private async enqueue(importId: string): Promise<void> {
    try {
      await this.queue.enqueueSemanticImport(importId);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Unable to schedule semantic import",
        { cause: error }
      );
    }
  }

  private async enqueueValidation(
    importId: string,
    version: number
  ): Promise<void> {
    try {
      await this.queue.enqueueSemanticImportValidation(importId, version);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Unable to schedule semantic import validation",
        { cause: error }
      );
    }
  }

  private async enqueuePublish(
    importId: string,
    version: number
  ): Promise<void> {
    try {
      await this.queue.enqueueSemanticImportPublish(importId, version);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Unable to schedule semantic import publishing",
        { cause: error }
      );
    }
  }

  private async requiredScoped(
    importId: string,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
    }
  ): Promise<SemanticImport> {
    const semanticImport = await this.prisma.semanticImport.findFirst({
      where: {
        id: importId,
        workspaceId: input.workspaceId,
        projectId: input.projectId
      }
    });
    if (!semanticImport) throw new NotFoundException("Import not found");
    return semanticImport;
  }
}

export function toSemanticImportSummary(
  value: SemanticImport
): SemanticImportSummary {
  const columns = safeColumns(value.suggestedMapping);
  const sampleRows = safeRows(value.sampleRows);
  const preview =
    columns && sampleRows
      ? {
          columns,
          sampleRows,
          totalRows: value.totalRows.toString(),
          validRows: value.validRows.toString(),
          warningRows: value.warningRows.toString(),
          errorRows: value.errorRows.toString()
        }
      : undefined;
  const failureCode =
    value.status === "FAILED" ? safeFailureCode(value.failure) : undefined;
  const mapping = safeMapping(value.confirmedMapping);
  const validation = safeValidation(value.validationSummary);
  const result = safeResult(value.resultSummary);
  const completedAt = ["COMPLETED", "FAILED", "CANCELLED"].includes(
    value.status
  )
    ? (value.publishingCompletedAt ??
      value.validationCompletedAt ??
      value.cancelRequestedAt ??
      value.parsingCompletedAt)
    : undefined;
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    uploadId: value.uploadId,
    status: value.status,
    stage: value.stage,
    sourceFormat: value.sourceFormat,
    ...(isDetectedEncoding(value.detectedEncoding)
      ? { encoding: value.detectedEncoding }
      : {}),
    ...(isDetectedDelimiter(value.detectedDelimiter)
      ? { delimiter: value.detectedDelimiter }
      : {}),
    headerMode: value.headerMode as SemanticImportSummary["headerMode"],
    progressBytes: value.progressBytes.toString(),
    totalBytes: value.totalBytes.toString(),
    ...(preview ? { preview } : {}),
    ...(mapping ? { mapping } : {}),
    ...(validation ? { validation } : {}),
    ...(result ? { result } : {}),
    ...(failureCode ? { failureCode } : {}),
    createdAt: value.createdAt.toISOString(),
    ...(completedAt
      ? { completedAt: completedAt.toISOString() }
      : {}),
    version: value.version
  };
}

function safeHeaders(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

export function safeMapping(
  value: unknown
): SemanticImportMapping | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    !Array.isArray(record.columns) ||
    typeof record.defaultLanguage !== "string" ||
    typeof record.groupSeparator !== "string" ||
    typeof record.duplicatePolicy !== "string" ||
    !semanticImportDuplicatePolicies.includes(
      record.duplicatePolicy as SemanticImportMapping["duplicatePolicy"]
    )
  ) {
    return undefined;
  }
  const columns = [];
  for (const item of record.columns) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("sourceIndex" in item) ||
      !Number.isSafeInteger(item.sourceIndex) ||
      !("target" in item) ||
      typeof item.target !== "string" ||
      !semanticImportTargets.includes(
        item.target as SemanticImportMapping["columns"][number]["target"]
      )
    ) {
      return undefined;
    }
    const customName =
      "customName" in item && typeof item.customName === "string"
        ? item.customName
        : undefined;
    columns.push({
      sourceIndex: Number(item.sourceIndex),
      target: item.target as SemanticImportMapping["columns"][number]["target"],
      ...(customName ? { customName } : {})
    });
  }
  return {
    columns,
    defaultLanguage: record.defaultLanguage,
    groupSeparator: record.groupSeparator,
    duplicatePolicy:
      record.duplicatePolicy as SemanticImportMapping["duplicatePolicy"]
  };
}

export function safeValidation(
  value: unknown
): SemanticImportSummary["validation"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const fields = [
    "totalRows",
    "validRows",
    "warningRows",
    "errorRows",
    "duplicateRowsInFile",
    "existingKeywordsInProject",
    "uniqueKeywordsToProcess"
  ] as const;
  if (
    fields.some((field) => typeof record[field] !== "string") ||
    typeof record.issueCounts !== "object" ||
    record.issueCounts === null ||
    Array.isArray(record.issueCounts) ||
    Object.values(record.issueCounts).some((count) => typeof count !== "string")
  ) {
    return undefined;
  }
  return value as NonNullable<SemanticImportSummary["validation"]>;
}

export function safeResult(
  value: unknown
): SemanticImportResultSummary | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const fields = [
    "semanticVersionId",
    "createdKeywords",
    "updatedKeywords",
    "skippedKeywords",
    "createdGroups",
    "createdPages",
    "createdTags",
    "createdMetricSnapshots"
  ] as const;
  if (
    fields.some((field) => typeof record[field] !== "string") ||
    typeof record.partial !== "boolean" ||
    !Number.isSafeInteger(record.semanticVersionNumber)
  ) {
    return undefined;
  }
  return value as unknown as SemanticImportResultSummary;
}

interface NormalizedOptions {
  readonly encoding: SemanticImportEncoding;
  readonly delimiter: SemanticImportDelimiter;
  readonly headerMode: "AUTO" | "PRESENT" | "ABSENT";
}

function normalizedOptions(
  input: InternalCreateSemanticImportInput
): NormalizedOptions {
  return {
    encoding: input.parse?.encoding ?? "AUTO",
    delimiter: input.parse?.delimiter ?? "AUTO",
    headerMode: input.parse?.headerMode ?? "AUTO"
  };
}

function safeColumns(value: unknown):
  | readonly SemanticImportColumnPreview[]
  | undefined {
  if (!Array.isArray(value)) return undefined;
  const columns: SemanticImportColumnPreview[] = [];
  for (const item of value) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("index" in item) ||
      !Number.isInteger(item.index) ||
      !("sourceName" in item) ||
      typeof item.sourceName !== "string" ||
      !("suggestedTarget" in item) ||
      typeof item.suggestedTarget !== "string" ||
      !("confidence" in item) ||
      typeof item.confidence !== "number"
    ) {
      return undefined;
    }
    columns.push({
      index: Number(item.index),
      sourceName: item.sourceName,
      suggestedTarget: item.suggestedTarget,
      confidence: item.confidence
    });
  }
  return columns;
}

function safeRows(value: unknown): readonly (readonly string[])[] | undefined {
  if (
    !Array.isArray(value) ||
    value.some(
      (row) =>
        !Array.isArray(row) ||
        row.some((cell) => typeof cell !== "string")
    )
  ) {
    return undefined;
  }
  return value as readonly (readonly string[])[];
}

function safeFailureCode(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("code" in value) ||
    typeof value.code !== "string"
  ) {
    return undefined;
  }
  return /^[A-Z][A-Z0-9_]{1,63}$/u.test(value.code)
    ? value.code
    : undefined;
}

function isDetectedEncoding(
  value: string | null
): value is Exclude<SemanticImportEncoding, "AUTO"> {
  return (
    value !== null &&
    value !== "AUTO" &&
    semanticImportEncodings.includes(value as SemanticImportEncoding)
  );
}

function isDetectedDelimiter(
  value: string | null
): value is Exclude<SemanticImportDelimiter, "AUTO"> {
  return (
    value !== null &&
    value !== "AUTO" &&
    semanticImportDelimiters.includes(value as SemanticImportDelimiter)
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function versionConflict(): ConflictException {
  return new ConflictException("Semantic import version conflict");
}
