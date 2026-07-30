import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type {
  InternalCreateSemanticCustomColumnInput,
  InternalDeleteSemanticCustomColumnInput,
  InternalDeleteSemanticKeywordCustomValueInput,
  InternalSetSemanticKeywordCustomValueInput,
  InternalUpdateSemanticCustomColumnInput,
  SemanticCustomColumn,
  SemanticCustomColumnConfig,
  SemanticCustomColumnType,
  SemanticKeywordCustomValue
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { typeConfig } from "./semantic-custom-column-input.js";

type ColumnRow = Prisma.SemanticCustomColumnGetPayload<
  Record<string, never>
>;
type ValueRow = Prisma.SemanticKeywordCustomValueGetPayload<{
  include: { column: { select: { type: true } } };
}>;
interface TypedValueData {
  readonly textValue?: string;
  readonly integerValue?: bigint;
  readonly decimalValue?: string;
  readonly booleanValue?: boolean;
  readonly dateValue?: Date;
  readonly datetimeValue?: Date;
  readonly stringArrayValue?: string[];
  readonly userId?: string;
}

@Injectable()
export class SemanticCustomColumnService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticCustomColumn[]> {
    const rows = await this.prisma.semanticCustomColumn.findMany({
      where: { workspaceId, projectId, status: "ACTIVE" },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500
    });
    return rows.map(customColumn);
  }

  public async create(
    input: InternalCreateSemanticCustomColumnInput
  ): Promise<SemanticCustomColumn> {
    try {
      return customColumn(
        await this.prisma.semanticCustomColumn.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            name: input.name,
            normalizedName: normalizeColumnName(input.name),
            ...(input.description
              ? { description: input.description }
              : {}),
            type: input.type,
            config: jsonConfig(input.config),
            createdBy: input.actorId,
            updatedBy: input.actorId
          }
        })
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateColumn();
      throw error;
    }
  }

  public async update(
    columnId: string,
    input: InternalUpdateSemanticCustomColumnInput
  ): Promise<SemanticCustomColumn> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockCustomColumn(transaction, input.projectId, columnId);
        const current = await requiredTransactionColumn(
          transaction,
          input.workspaceId,
          input.projectId,
          columnId
        );
        assertColumnVersion(current.version, input.version);
        const nextConfig =
          input.config === undefined
            ? undefined
            : typeConfig(input.config, current.type);
        if (nextConfig) {
          await assertUsedOptionsRemain(
            transaction,
            input.workspaceId,
            input.projectId,
            columnId,
            current.type,
            nextConfig
          );
        }
        await transaction.semanticCustomColumn.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: columnId
            }
          },
          data: {
            ...(input.name === undefined
              ? {}
              : {
                  name: input.name,
                  normalizedName: normalizeColumnName(input.name)
                }),
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            ...(nextConfig === undefined
              ? {}
              : { config: jsonConfig(nextConfig) }),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        return customColumn(
          await transaction.semanticCustomColumn.findUniqueOrThrow({
            where: {
              workspaceId_projectId_id: {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                id: columnId
              }
            }
          })
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateColumn();
      throw error;
    }
  }

  public async delete(
    columnId: string,
    input: InternalDeleteSemanticCustomColumnInput
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockCustomColumn(transaction, input.projectId, columnId);
      const current = await requiredTransactionColumn(
        transaction,
        input.workspaceId,
        input.projectId,
        columnId
      );
      assertColumnVersion(current.version, input.version);
      await transaction.semanticCustomColumn.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: columnId
          }
        },
        data: {
          status: "DELETED",
          normalizedName: `${columnId}:deleted`,
          updatedBy: input.actorId,
          deletedAt: new Date(),
          version: { increment: 1 }
        }
      });
    });
  }

  public async setKeywordValue(
    keywordId: string,
    columnId: string,
    input: InternalSetSemanticKeywordCustomValueInput
  ): Promise<SemanticKeywordCustomValue> {
    return this.prisma.$transaction(async (transaction) => {
      await lockColumnAndKeyword(
        transaction,
        input.projectId,
        columnId,
        keywordId
      );
      const [column] = await Promise.all([
        requiredTransactionColumn(
          transaction,
          input.workspaceId,
          input.projectId,
          columnId
        ),
        requiredTransactionKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId
        )
      ]);
      const current =
        await transaction.semanticKeywordCustomValue.findUnique({
          where: { keywordId_columnId: { keywordId, columnId } }
        });
      if (!current && input.expectedVersion !== null) {
        throw valueConflict(null);
      }
      if (current && current.version !== input.expectedVersion) {
        throw valueConflict(current.version);
      }
      const data = typedValueData(column, input.value);
      if (current) {
        await transaction.semanticKeywordCustomValue.update({
          where: { keywordId_columnId: { keywordId, columnId } },
          data: {
            ...data,
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      } else {
        await transaction.semanticKeywordCustomValue.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            keywordId,
            columnId,
            ...data,
            updatedBy: input.actorId
          }
        });
      }
      return customValue(
        await transaction.semanticKeywordCustomValue.findUniqueOrThrow({
          where: { keywordId_columnId: { keywordId, columnId } },
          include: { column: { select: { type: true } } }
        })
      );
    });
  }

  public async deleteKeywordValue(
    keywordId: string,
    columnId: string,
    input: InternalDeleteSemanticKeywordCustomValueInput
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockColumnAndKeyword(
        transaction,
        input.projectId,
        columnId,
        keywordId
      );
      await requiredTransactionKeyword(
        transaction,
        input.workspaceId,
        input.projectId,
        keywordId
      );
      const current =
        await transaction.semanticKeywordCustomValue.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            keywordId,
            columnId
          }
        });
      if (!current) throw valueNotFound();
      if (current.version !== input.version) {
        throw valueConflict(current.version);
      }
      await transaction.semanticKeywordCustomValue.delete({
        where: { keywordId_columnId: { keywordId, columnId } }
      });
    });
  }

}

function customColumn(row: ColumnRow): SemanticCustomColumn {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    type: row.type,
    config: row.config as unknown as SemanticCustomColumnConfig,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function customValue(row: ValueRow): SemanticKeywordCustomValue {
  return {
    columnId: row.columnId,
    value: storedValue(row),
    version: row.version,
    updatedAt: row.updatedAt.toISOString()
  };
}

function storedValue(row: ValueRow) {
  switch (row.column.type) {
    case "TEXT":
    case "LONG_TEXT":
    case "SELECT":
    case "STATUS":
    case "URL":
      return row.textValue!;
    case "INTEGER":
      return Number(row.integerValue!);
    case "DECIMAL":
      return row.decimalValue!.toString();
    case "BOOLEAN":
      return row.booleanValue!;
    case "DATE":
      return row.dateValue!.toISOString().slice(0, 10);
    case "DATETIME":
      return row.datetimeValue!.toISOString();
    case "MULTI_SELECT":
      return row.stringArrayValue;
    case "USER":
      return row.userId!;
  }
}

function typedValueData(
  column: ColumnRow,
  value: InternalSetSemanticKeywordCustomValueInput["value"]
): TypedValueData {
  switch (column.type) {
    case "TEXT":
      return { textValue: requiredString(value, 1_000, "TEXT") };
    case "LONG_TEXT":
      return { textValue: requiredString(value, 1_000_000, "LONG_TEXT") };
    case "INTEGER":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw typeMismatch(column.type);
      }
      return { integerValue: BigInt(value) };
    case "DECIMAL": {
      const decimal = requiredString(value, 31, "DECIMAL");
      if (!/^-?\d{1,20}(?:\.\d{1,10})?$/u.test(decimal)) {
        throw typeMismatch(column.type);
      }
      return { decimalValue: decimal };
    }
    case "BOOLEAN":
      if (typeof value !== "boolean") throw typeMismatch(column.type);
      return { booleanValue: value };
    case "DATE": {
      const date = requiredString(value, 10, "DATE");
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
        throw typeMismatch(column.type);
      }
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date
      ) {
        throw typeMismatch(column.type);
      }
      return { dateValue: parsed };
    }
    case "DATETIME": {
      const date = new Date(requiredString(value, 40, "DATETIME"));
      if (Number.isNaN(date.getTime())) throw typeMismatch(column.type);
      return { datetimeValue: date };
    }
    case "SELECT":
    case "STATUS": {
      const selected = requiredString(value, 64, column.type);
      assertAllowedOptions(column, [selected]);
      return { textValue: selected };
    }
    case "MULTI_SELECT":
      if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
        throw typeMismatch(column.type);
      }
      assertAllowedOptions(column, value);
      return { stringArrayValue: [...value] };
    case "URL": {
      const source = requiredString(value, 2_048, "URL");
      let url: URL;
      try {
        url = new URL(source);
      } catch {
        throw typeMismatch(column.type);
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        throw typeMismatch(column.type);
      }
      return { textValue: url.toString() };
    }
    case "USER":
      return { userId: requiredUuid(value, "USER") };
  }
}

function requiredString(
  value: unknown,
  maxLength: number,
  type: SemanticCustomColumnType
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength
  ) {
    throw typeMismatch(type);
  }
  return value;
}

function requiredUuid(value: unknown, type: SemanticCustomColumnType): string {
  const uuid = requiredString(value, 36, type);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      uuid
    )
  ) {
    throw typeMismatch(type);
  }
  return uuid.toLowerCase();
}

function assertAllowedOptions(
  column: ColumnRow,
  selected: readonly string[]
): void {
  const config = column.config as unknown as SemanticCustomColumnConfig;
  const allowed = new Set(config.options?.map(({ id }) => id) ?? []);
  if (
    selected.some((value) => !allowed.has(value)) ||
    new Set(selected).size !== selected.length
  ) {
    throw typeMismatch(column.type);
  }
}

async function requiredTransactionColumn(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  columnId: string
): Promise<ColumnRow> {
  const column = await transaction.semanticCustomColumn.findFirst({
    where: { id: columnId, workspaceId, projectId, status: "ACTIVE" }
  });
  if (!column) throw columnNotFound();
  return column;
}

async function requiredTransactionKeyword(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  keywordId: string
): Promise<void> {
  const keyword = await transaction.keyword.findFirst({
    where: {
      id: keywordId,
      workspaceId,
      projectId,
      status: "ACTIVE"
    },
    select: { id: true }
  });
  if (!keyword) throw valueNotFound();
}

async function lockColumnAndKeyword(
  transaction: Prisma.TransactionClient,
  projectId: string,
  columnId: string,
  keywordId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "semantic_custom_columns"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${columnId}::uuid
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "keywords"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${keywordId}::uuid
    FOR UPDATE
  `;
}

async function lockCustomColumn(
  transaction: Prisma.TransactionClient,
  projectId: string,
  columnId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "semantic_custom_columns"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${columnId}::uuid
    FOR UPDATE
  `;
}

async function assertUsedOptionsRemain(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  columnId: string,
  type: SemanticCustomColumnType,
  config: SemanticCustomColumnConfig
): Promise<void> {
  if (!["SELECT", "MULTI_SELECT", "STATUS"].includes(type)) return;
  const used = await transaction.$queryRaw<readonly { value: string }[]>`
    SELECT DISTINCT "text_value" AS "value"
    FROM "semantic_keyword_custom_values"
    WHERE "workspace_id" = ${workspaceId}::uuid
      AND "project_id" = ${projectId}::uuid
      AND "column_id" = ${columnId}::uuid
      AND "text_value" IS NOT NULL
    UNION
    SELECT DISTINCT unnest("string_array_value") AS "value"
    FROM "semantic_keyword_custom_values"
    WHERE "workspace_id" = ${workspaceId}::uuid
      AND "project_id" = ${projectId}::uuid
      AND "column_id" = ${columnId}::uuid
      AND cardinality("string_array_value") > 0
  `;
  const allowed = new Set(config.options?.map(({ id }) => id) ?? []);
  if (used.some(({ value }) => !allowed.has(value))) {
    throw new HttpException(
      {
        code: "RESOURCE_STATE_CONFLICT",
        message: "Used custom column options cannot be removed"
      },
      HttpStatus.CONFLICT
    );
  }
}

function assertColumnVersion(current: number, expected: number): void {
  if (current === expected) return;
  throw new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic custom column version conflict",
      currentVersion: current
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function jsonConfig(config: SemanticCustomColumnConfig): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(config)) as Prisma.InputJsonObject;
}

function normalizeColumnName(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

function typeMismatch(type: SemanticCustomColumnType): BadRequestException {
  return new BadRequestException(
    `Custom value does not match ${type} column`
  );
}

function columnNotFound(): HttpException {
  return new HttpException(
    { code: "NOT_FOUND", message: "Semantic custom column not found" },
    HttpStatus.NOT_FOUND
  );
}

function valueNotFound(): HttpException {
  return new HttpException(
    { code: "NOT_FOUND", message: "Semantic custom value not found" },
    HttpStatus.NOT_FOUND
  );
}

function valueConflict(currentVersion: number | null): HttpException {
  return new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic custom value version conflict",
      currentVersion
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function duplicateColumn(): HttpException {
  return new HttpException(
    {
      code: "DUPLICATE",
      message: "A custom column with this name already exists"
    },
    HttpStatus.CONFLICT
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
