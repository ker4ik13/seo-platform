import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  domainEventTypes,
  semanticImportDelimiters,
  semanticImportEncodings,
  type InternalCreateSemanticImportInput,
  type SemanticImportColumnPreview,
  type SemanticImportDelimiter,
  type SemanticImportEncoding,
  type SemanticImportSummary
} from "@seo-platform/contracts";
import type { SemanticImport } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";

const SUPPORTED_SOURCE_FORMATS: Readonly<Record<string, string>> = {
  "text/csv": "CSV",
  "text/tab-separated-values": "TSV"
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
    ...(failureCode ? { failureCode } : {}),
    createdAt: value.createdAt.toISOString(),
    ...(value.parsingCompletedAt
      ? { completedAt: value.parsingCompletedAt.toISOString() }
      : {}),
    version: value.version
  };
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
