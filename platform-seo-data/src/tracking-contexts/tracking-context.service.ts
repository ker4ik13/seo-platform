import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import {
  domainEventTypes,
  trackingContextStatuses,
  trackingDepths,
  trackingDevices,
  trackingDomainMatchModes,
  trackingSearchEngines,
  type ApiCollectionResponse,
  type InternalChangeTrackingContextKeywordInput,
  type InternalChangeTrackingContextStatusInput,
  type InternalCreateTrackingContextInput,
  type InternalUpdateTrackingContextInput,
  type TrackingContextCollection,
  type TrackingContextConfigurationInput,
  type TrackingContextConfigurationSnapshot,
  type TrackingContextEventDataV1,
  type TrackingContextKeywordAssignmentEventDataV1,
  type TrackingContextKeywordAssignmentItem,
  type TrackingContextKeywordAssignmentState,
  type TrackingContextKeywordQuery,
  type TrackingContextSummary,
  type TrackingDomainMatchRule
} from "@seo-platform/contracts";
import {
  Prisma,
  type TrackingContextVersion
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertSemanticCapacity,
  lockTrackedContextPairCapacity
} from "../internal/semantic-capacity.js";
import { normalizeKeywordText } from "../keywords/keyword-normalization.js";

const CONTEXT_LIMIT = 200;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTEXT_INCLUDE = {
  configurations: {
    orderBy: { configurationVersion: "desc" as const },
    take: 1
  },
  _count: {
    select: {
      keywordAssignments: {
        where: {
          removedAt: null,
          keyword: { status: "ACTIVE" as const }
        }
      }
    }
  }
} satisfies Prisma.TrackingContextInclude;

type ContextAggregate = Prisma.TrackingContextGetPayload<{
  include: typeof CONTEXT_INCLUDE;
}>;

interface AssignmentCursor {
  readonly version: 1;
  readonly contextId: string;
  readonly search: string;
  readonly assignedAt: string;
  readonly id: string;
}

@Injectable()
export class TrackingContextService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<TrackingContextCollection> {
    const rows = await this.prisma.trackingContext.findMany({
      where: { workspaceId, projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CONTEXT_LIMIT + 1,
      include: CONTEXT_INCLUDE
    });
    return {
      contexts: rows.slice(0, CONTEXT_LIMIT).map(contextSummary),
      contextsTruncated: rows.length > CONTEXT_LIMIT
    };
  }

  public async get(
    workspaceId: string,
    projectId: string,
    contextId: string
  ): Promise<TrackingContextSummary> {
    return contextSummary(
      await this.requiredContext(
        this.prisma,
        workspaceId,
        projectId,
        contextId
      )
    );
  }

  public async create(
    input: InternalCreateTrackingContextInput
  ): Promise<TrackingContextSummary> {
    const requestHash = createRequestHash(input);
    const existing = await this.findCreateReceipt(input);
    if (existing) return receiptReplay(existing, requestHash, input);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const concurrent = await transaction.trackingContextCreateReceipt.findUnique({
          where: createReceiptWhere(input)
        });
        if (concurrent) {
          return receiptReplay(concurrent, requestHash, input);
        }
        const configurationHash = hashConfiguration(input.configuration);
        const context = await transaction.trackingContext.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            name: input.name,
            createdBy: input.actorId,
            updatedBy: input.actorId,
            configurations: {
              create: configurationCreateData(
                input,
                input.configuration,
                configurationHash,
                1
              )
            }
          },
          include: CONTEXT_INCLUDE
        });
        const summary = contextSummary(context);
        await transaction.trackingContextCreateReceipt.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            contextId: context.id,
            responseSnapshot: json(summary)
          }
        });
        await emitContextEvent(
          transaction,
          domainEventTypes.trackingContextCreated,
          summary,
          input.actorId,
          ["name", "configuration", "status"]
        );
        return summary;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.findCreateReceipt(input);
      if (winner) return receiptReplay(winner, requestHash, input);
      throw error;
    }
  }

  public async update(
    contextId: string,
    input: InternalUpdateTrackingContextInput
  ): Promise<TrackingContextSummary> {
    return this.prisma.$transaction(async (transaction) => {
      await lockContext(transaction, input, contextId);
      const current = await this.requiredContext(
        transaction,
        input.workspaceId,
        input.projectId,
        contextId
      );
      assertVersion(current.version, input.version);
      assertActive(current.status);

      const currentConfiguration = requiredConfiguration(current);
      const configurationHash = hashConfiguration(input.configuration);
      const nameChanged = current.name !== input.name;
      const configurationChanged =
        currentConfiguration.configurationHash !== configurationHash;
      if (!nameChanged && !configurationChanged) {
        return contextSummary(current);
      }
      if (configurationChanged) {
        await transaction.trackingContextVersion.create({
          data: configurationCreateData(
            input,
            input.configuration,
            configurationHash,
            currentConfiguration.configurationVersion + 1,
            contextId
          )
        });
      }
      await transaction.trackingContext.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: contextId
          }
        },
        data: {
          ...(nameChanged ? { name: input.name } : {}),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      const updated = await this.requiredContext(
        transaction,
        input.workspaceId,
        input.projectId,
        contextId
      );
      const summary = contextSummary(updated);
      await emitContextEvent(
        transaction,
        domainEventTypes.trackingContextUpdated,
        summary,
        input.actorId,
        [
          ...(nameChanged ? (["name"] as const) : []),
          ...(configurationChanged ? (["configuration"] as const) : [])
        ]
      );
      return summary;
    });
  }

  public async archive(
    contextId: string,
    input: InternalChangeTrackingContextStatusInput
  ): Promise<TrackingContextSummary> {
    return this.changeStatus(contextId, input, "ARCHIVED");
  }

  public async restore(
    contextId: string,
    input: InternalChangeTrackingContextStatusInput
  ): Promise<TrackingContextSummary> {
    return this.changeStatus(contextId, input, "ACTIVE");
  }

  public async listKeywords(
    workspaceId: string,
    projectId: string,
    contextId: string,
    query: TrackingContextKeywordQuery,
    requestId: string
  ): Promise<ApiCollectionResponse<TrackingContextKeywordAssignmentItem>> {
    await this.assertContextExists(
      this.prisma,
      workspaceId,
      projectId,
      contextId
    );
    const search = normalizeKeywordText(query.search);
    const cursor = query.cursor
      ? decodeAssignmentCursor(query.cursor, contextId, search)
      : undefined;
    const baseWhere: Prisma.TrackingContextKeywordAssignmentWhereInput = {
      workspaceId,
      projectId,
      contextId,
      removedAt: null,
      keyword: {
        status: "ACTIVE",
        ...(search
          ? { textNormalized: { contains: search } }
          : {})
      }
    };
    const rows = await this.prisma.trackingContextKeywordAssignment.findMany({
      where: {
        ...baseWhere,
        ...(cursor
          ? {
              OR: [
                { assignedAt: { lt: new Date(cursor.assignedAt) } },
                {
                  assignedAt: new Date(cursor.assignedAt),
                  id: { lt: cursor.id }
                }
              ]
            }
          : {})
      },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      include: {
        keyword: {
          select: {
            id: true,
            textOriginal: true,
            language: true
          }
        }
      }
    });
    const totalApprox = cursor
      ? undefined
      : await this.prisma.trackingContextKeywordAssignment.count({
          where: baseWhere
        });
    const hasNext = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) => ({
        assignmentId: row.id,
        contextId: row.contextId,
        keywordId: row.keyword.id,
        textOriginal: row.keyword.textOriginal,
        language: row.keyword.language,
        assignedBy: row.assignedBy,
        assignedAt: row.assignedAt.toISOString()
      })),
      page: {
        hasNext,
        ...(totalApprox === undefined ? {} : { totalApprox }),
        ...(hasNext && last
          ? {
              nextCursor: encodeAssignmentCursor({
                version: 1,
                contextId,
                search,
                assignedAt: last.assignedAt.toISOString(),
                id: last.id
              })
            }
          : {})
      },
      meta: { requestId }
    };
  }

  public async assignKeyword(
    input: InternalChangeTrackingContextKeywordInput
  ): Promise<TrackingContextKeywordAssignmentState> {
    return this.changeKeywordAssignment(input, true);
  }

  public async removeKeyword(
    input: InternalChangeTrackingContextKeywordInput
  ): Promise<TrackingContextKeywordAssignmentState> {
    return this.changeKeywordAssignment(input, false);
  }

  private async changeStatus(
    contextId: string,
    input: InternalChangeTrackingContextStatusInput,
    status: "ACTIVE" | "ARCHIVED"
  ): Promise<TrackingContextSummary> {
    return this.prisma.$transaction(async (transaction) => {
      await lockContext(transaction, input, contextId);
      const current = await this.requiredContext(
        transaction,
        input.workspaceId,
        input.projectId,
        contextId
      );
      assertVersion(current.version, input.version);
      if (current.status === status) {
        conflict(
          status === "ARCHIVED"
            ? "Tracking context is already archived"
            : "Tracking context is already active"
        );
      }
      const now = new Date();
      await transaction.trackingContext.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: contextId
          }
        },
        data: {
          status,
          updatedBy: input.actorId,
          version: { increment: 1 },
          ...(status === "ARCHIVED"
            ? { archivedBy: input.actorId, archivedAt: now }
            : { archivedBy: null, archivedAt: null })
        }
      });
      const updated = await this.requiredContext(
        transaction,
        input.workspaceId,
        input.projectId,
        contextId
      );
      const summary = contextSummary(updated);
      await emitContextEvent(
        transaction,
        status === "ARCHIVED"
          ? domainEventTypes.trackingContextArchived
          : domainEventTypes.trackingContextRestored,
        summary,
        input.actorId,
        ["status"]
      );
      return summary;
    });
  }

  private async changeKeywordAssignment(
    input: InternalChangeTrackingContextKeywordInput,
    assign: boolean
  ): Promise<TrackingContextKeywordAssignmentState> {
    return this.prisma.$transaction(async (transaction) => {
      if (assign) {
        await lockTrackedContextPairCapacity(
          transaction,
          input.workspaceId
        );
      }
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${input.contextId}:${input.keywordId}`}, 0)
        )
      `;
      const context = await transaction.trackingContext.findFirst({
        where: {
          id: input.contextId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        },
        select: { status: true }
      });
      if (!context) notFound();
      assertActive(context.status);
      const keyword = await transaction.keyword.findFirst({
        where: {
          id: input.keywordId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE"
        },
        select: { id: true }
      });
      if (!keyword) {
        internalError(
          HttpStatus.NOT_FOUND,
          "KEYWORD_NOT_FOUND",
          "Keyword not found"
        );
      }
      const existing =
        await transaction.trackingContextKeywordAssignment.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            contextId: input.contextId,
            keywordId: input.keywordId,
            removedAt: null
          }
        });
      if (assign && existing) {
        return {
          contextId: input.contextId,
          keywordId: input.keywordId,
          assigned: true,
          assignmentId: existing.id,
          changedAt: existing.assignedAt.toISOString()
        };
      }
      if (!assign && !existing) {
        return {
          contextId: input.contextId,
          keywordId: input.keywordId,
          assigned: false
        };
      }
      if (assign) {
        const current =
          await transaction.trackingContextKeywordAssignment.count({
            where: {
              workspaceId: input.workspaceId,
              removedAt: null,
              context: { status: "ACTIVE" },
              keyword: { status: "ACTIVE" }
            }
          });
        assertSemanticCapacity(
          "trackedContextPairs",
          BigInt(current),
          1n,
          input.entitlement.trackedContextPairs,
          input.entitlement
        );
      }
      const now = new Date();
      let assignmentId: string | undefined;
      if (assign) {
        const created =
          await transaction.trackingContextKeywordAssignment.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              contextId: input.contextId,
              keywordId: input.keywordId,
              assignedBy: input.actorId,
              assignedAt: now
            }
          });
        assignmentId = created.id;
      } else {
        await transaction.trackingContextKeywordAssignment.update({
          where: { id: existing!.id },
          data: {
            removedBy: input.actorId,
            removedAt: now
          }
        });
      }
      await emitKeywordAssignmentEvent(
        transaction,
        input,
        assign ? "ASSIGNED" : "REMOVED"
      );
      return {
        contextId: input.contextId,
        keywordId: input.keywordId,
        assigned: assign,
        ...(assignmentId ? { assignmentId } : {}),
        changedAt: now.toISOString()
      };
    });
  }

  private async requiredContext(
    client: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    contextId: string
  ): Promise<ContextAggregate> {
    const context = await client.trackingContext.findFirst({
      where: { id: contextId, workspaceId, projectId },
      include: CONTEXT_INCLUDE
    });
    if (!context) notFound();
    return context;
  }

  private async assertContextExists(
    client: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    contextId: string
  ): Promise<void> {
    const context = await client.trackingContext.findFirst({
      where: { id: contextId, workspaceId, projectId },
      select: { id: true }
    });
    if (!context) notFound();
  }

  private findCreateReceipt(input: InternalCreateTrackingContextInput) {
    return this.prisma.trackingContextCreateReceipt.findUnique({
      where: createReceiptWhere(input)
    });
  }
}

function contextSummary(context: ContextAggregate): TrackingContextSummary {
  const configuration = requiredConfiguration(context);
  return {
    id: context.id,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    name: context.name,
    status: context.status,
    configuration: configurationSnapshot(configuration),
    assignedKeywordCount: context._count.keywordAssignments,
    version: context.version,
    createdBy: context.createdBy,
    updatedBy: context.updatedBy,
    ...(context.archivedBy ? { archivedBy: context.archivedBy } : {}),
    createdAt: context.createdAt.toISOString(),
    updatedAt: context.updatedAt.toISOString(),
    ...(context.archivedAt
      ? { archivedAt: context.archivedAt.toISOString() }
      : {})
  };
}

function configurationSnapshot(
  configuration: TrackingContextVersion
): TrackingContextConfigurationSnapshot {
  return {
    searchEngine: configuration.searchEngine,
    countryCode: configuration.countryCode,
    ...(configuration.regionCode
      ? { regionCode: configuration.regionCode }
      : {}),
    ...(configuration.regionLabel
      ? { regionLabel: configuration.regionLabel }
      : {}),
    language: configuration.language,
    device: configuration.device,
    depth: configuration.depth as 30 | 50 | 100,
    domainMatchRule: domainRule(configuration),
    safeSearch: configuration.safeSearch,
    configurationVersion: configuration.configurationVersion,
    createdBy: configuration.createdBy,
    createdAt: configuration.createdAt.toISOString()
  };
}

function domainRule(
  configuration: TrackingContextVersion
): TrackingDomainMatchRule {
  if (
    configuration.domainMatchMode === "SPECIFIC_URL" ||
    configuration.domainMatchMode === "URL_PREFIX"
  ) {
    if (!configuration.domainMatchValue) {
      throw new Error("Stored tracking domain rule is incomplete");
    }
    return {
      mode: configuration.domainMatchMode,
      value: configuration.domainMatchValue
    };
  }
  return { mode: configuration.domainMatchMode };
}

function requiredConfiguration(
  context: Pick<ContextAggregate, "configurations">
): TrackingContextVersion {
  const configuration = context.configurations[0];
  if (!configuration) {
    throw new Error("Tracking context has no configuration version");
  }
  return configuration;
}

function configurationCreateData(
  scope: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  },
  configuration: TrackingContextConfigurationInput,
  configurationHash: string,
  configurationVersion: number,
  contextId?: string
) {
  return {
    ...(contextId ? { contextId } : {}),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    configurationVersion,
    searchEngine: configuration.searchEngine,
    countryCode: configuration.countryCode,
    ...(configuration.regionCode
      ? { regionCode: configuration.regionCode }
      : {}),
    ...(configuration.regionLabel
      ? { regionLabel: configuration.regionLabel }
      : {}),
    language: configuration.language,
    device: configuration.device,
    depth: configuration.depth,
    domainMatchMode: configuration.domainMatchRule.mode,
    ...("value" in configuration.domainMatchRule
      ? { domainMatchValue: configuration.domainMatchRule.value }
      : {}),
    safeSearch: configuration.safeSearch,
    configurationHash,
    createdBy: scope.actorId
  };
}

function hashConfiguration(
  configuration: TrackingContextConfigurationInput
): string {
  return createHash("sha256")
    .update(canonicalJson(configuration))
    .digest("hex");
}

function createRequestHash(
  input: InternalCreateTrackingContextInput
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    createHash("sha256")
      .update(
        canonicalJson({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          name: input.name,
          configuration: input.configuration
        })
      )
      .digest()
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function createReceiptWhere(input: InternalCreateTrackingContextInput) {
  return {
    workspaceId_projectId_actorId_idempotencyKey: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey
    }
  };
}

function receiptReplay(
  receipt: {
    readonly requestHash: Uint8Array;
    readonly responseSnapshot: unknown;
    readonly contextId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  },
  requestHash: Uint8Array<ArrayBuffer>,
  input: InternalCreateTrackingContextInput
): TrackingContextSummary {
  const stored = Buffer.from(receipt.requestHash);
  if (
    stored.length !== requestHash.length ||
    !timingSafeEqual(stored, requestHash)
  ) {
    internalError(
      HttpStatus.CONFLICT,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used with another request"
    );
  }
  const snapshot = parseSummarySnapshot(receipt.responseSnapshot);
  if (
    snapshot.id !== receipt.contextId ||
    snapshot.workspaceId !== receipt.workspaceId ||
    snapshot.projectId !== receipt.projectId ||
    snapshot.workspaceId !== input.workspaceId ||
    snapshot.projectId !== input.projectId
  ) {
    throw new Error("Stored tracking context receipt is inconsistent");
  }
  return snapshot;
}

function parseSummarySnapshot(value: unknown): TrackingContextSummary {
  const input = record(value, "tracking context receipt");
  const configuration = record(
    input.configuration,
    "tracking context receipt configuration"
  );
  const mode = enumValue(
    configuration.domainMatchRule &&
      record(configuration.domainMatchRule, "domain rule").mode,
    trackingDomainMatchModes,
    "domain mode"
  );
  const domainInput = record(configuration.domainMatchRule, "domain rule");
  const domainMatchRule: TrackingDomainMatchRule =
    mode === "SPECIFIC_URL" || mode === "URL_PREFIX"
      ? { mode, value: stringValue(domainInput.value, "domain value") }
      : { mode };
  return {
    id: stringValue(input.id, "id"),
    workspaceId: stringValue(input.workspaceId, "workspaceId"),
    projectId: stringValue(input.projectId, "projectId"),
    name: stringValue(input.name, "name"),
    status: enumValue(input.status, trackingContextStatuses, "status"),
    configuration: {
      searchEngine: enumValue(
        configuration.searchEngine,
        trackingSearchEngines,
        "searchEngine"
      ),
      countryCode: stringValue(configuration.countryCode, "countryCode"),
      ...(optionalString(configuration.regionCode)
        ? { regionCode: optionalString(configuration.regionCode)! }
        : {}),
      ...(optionalString(configuration.regionLabel)
        ? { regionLabel: optionalString(configuration.regionLabel)! }
        : {}),
      language: stringValue(configuration.language, "language"),
      device: enumValue(configuration.device, trackingDevices, "device"),
      depth: enumValue(configuration.depth, trackingDepths, "depth"),
      domainMatchRule,
      safeSearch: booleanValue(configuration.safeSearch, "safeSearch"),
      configurationVersion: integerValue(
        configuration.configurationVersion,
        "configurationVersion"
      ),
      createdBy: stringValue(configuration.createdBy, "createdBy"),
      createdAt: isoDate(configuration.createdAt, "configuration.createdAt")
    },
    assignedKeywordCount: integerValue(
      input.assignedKeywordCount,
      "assignedKeywordCount",
      true
    ),
    version: integerValue(input.version, "version"),
    createdBy: stringValue(input.createdBy, "createdBy"),
    updatedBy: stringValue(input.updatedBy, "updatedBy"),
    ...(optionalString(input.archivedBy)
      ? { archivedBy: optionalString(input.archivedBy)! }
      : {}),
    createdAt: isoDate(input.createdAt, "createdAt"),
    updatedAt: isoDate(input.updatedAt, "updatedAt"),
    ...(optionalString(input.archivedAt)
      ? { archivedAt: isoDate(input.archivedAt, "archivedAt") }
      : {})
  };
}

async function lockContext(
  transaction: Prisma.TransactionClient,
  scope: { readonly workspaceId: string; readonly projectId: string },
  contextId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "tracking_contexts"
    WHERE "workspace_id" = ${scope.workspaceId}::uuid
      AND "project_id" = ${scope.projectId}::uuid
      AND "id" = ${contextId}::uuid
    FOR UPDATE
  `;
}

async function emitContextEvent(
  transaction: Prisma.TransactionClient,
  eventType: string,
  summary: TrackingContextSummary,
  actorId: string,
  changedFields: TrackingContextEventDataV1["changedFields"]
): Promise<void> {
  const payload: TrackingContextEventDataV1 = {
    contextId: summary.id,
    workspaceId: summary.workspaceId,
    projectId: summary.projectId,
    status: summary.status,
    entityVersion: summary.version,
    configurationVersion: summary.configuration.configurationVersion,
    searchEngine: summary.configuration.searchEngine,
    device: summary.configuration.device,
    changedBy: actorId,
    changedFields
  };
  await transaction.outboxEvent.create({
    data: {
      eventType,
      aggregateId: summary.id,
      workspaceId: summary.workspaceId,
      projectId: summary.projectId,
      payload: json(payload),
      metadata: {
        producer: "seo-data",
        source: "tracking-context"
      }
    }
  });
}

async function emitKeywordAssignmentEvent(
  transaction: Prisma.TransactionClient,
  input: InternalChangeTrackingContextKeywordInput,
  operation: "ASSIGNED" | "REMOVED"
): Promise<void> {
  const payload: TrackingContextKeywordAssignmentEventDataV1 = {
    contextId: input.contextId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    keywordId: input.keywordId,
    operation,
    changedBy: input.actorId
  };
  await transaction.outboxEvent.create({
    data: {
      eventType: domainEventTypes.trackingContextKeywordAssignmentChanged,
      aggregateId: input.contextId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      payload: json(payload),
      metadata: {
        producer: "seo-data",
        source: "tracking-context"
      }
    }
  });
}

function encodeAssignmentCursor(value: AssignmentCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeAssignmentCursor(
  value: string,
  contextId: string,
  search: string
): AssignmentCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }
  const cursor = record(parsed, "cursor");
  const assignedAt =
    typeof cursor.assignedAt === "string"
      ? new Date(cursor.assignedAt)
      : new Date(Number.NaN);
  if (
    cursor.version !== 1 ||
    cursor.contextId !== contextId ||
    cursor.search !== search ||
    typeof cursor.id !== "string" ||
    !UUID_PATTERN.test(cursor.id) ||
    Object.keys(cursor).some(
      (key) =>
        ![
          "version",
          "contextId",
          "search",
          "assignedAt",
          "id"
        ].includes(key)
    ) ||
    Number.isNaN(assignedAt.getTime())
  ) {
    invalidCursor();
  }
  return {
    version: 1,
    contextId,
    search,
    assignedAt: assignedAt.toISOString(),
    id: cursor.id
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    internalError(
      HttpStatus.PRECONDITION_FAILED,
      "VERSION_CONFLICT",
      "Tracking context version is stale",
      { currentVersion: actual }
    );
  }
}

function assertActive(status: string): void {
  if (status !== "ACTIVE") {
    conflict("Archived tracking context cannot be changed");
  }
}

function notFound(): never {
  internalError(
    HttpStatus.NOT_FOUND,
    "TRACKING_CONTEXT_NOT_FOUND",
    "Tracking context not found"
  );
}

function conflict(message: string): never {
  internalError(
    HttpStatus.CONFLICT,
    "TRACKING_CONTEXT_STATE_CONFLICT",
    message
  );
}

function invalidCursor(): never {
  internalError(
    HttpStatus.BAD_REQUEST,
    "INVALID_CURSOR",
    "Tracking context keyword cursor is invalid for this query"
  );
}

function internalError(
  status: HttpStatus,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>
): never {
  throw new HttpException(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {})
      }
    },
    status
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function record(
  value: unknown,
  field: string
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid stored ${field}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Invalid stored ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid stored ${field}`);
  }
  return value;
}

function integerValue(
  value: unknown,
  field: string,
  allowZero = false
): number {
  if (
    !Number.isSafeInteger(value) ||
    (allowZero ? Number(value) < 0 : Number(value) < 1)
  ) {
    throw new Error(`Invalid stored ${field}`);
  }
  return Number(value);
}

function isoDate(value: unknown, field: string): string {
  const date =
    typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid stored ${field}`);
  }
  return date.toISOString();
}

function enumValue<const Values extends readonly (string | number)[]>(
  value: unknown,
  values: Values,
  field: string
): Values[number] {
  if (!values.includes(value as never)) {
    throw new Error(`Invalid stored ${field}`);
  }
  return value as Values[number];
}
