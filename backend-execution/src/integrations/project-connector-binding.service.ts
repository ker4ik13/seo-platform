import { createHash, timingSafeEqual } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException
} from "@nestjs/common";
import {
  domainEventTypes,
  connectorFallbackModes,
  connectorFallbackReasons,
  integrationCapabilities,
  integrationProviders,
  projectConnectorBindingChangedFields,
  projectConnectorBindingAvailabilities,
  type IntegrationCapability,
  type IntegrationProvider,
  type ConnectorFallbackMode,
  type ConnectorFallbackReason,
  type ConnectorRoutingScope,
  type InternalCreateProjectConnectorBindingInput,
  type InternalInheritProjectConnectorBindingInput,
  type InternalUpdateProjectConnectorBindingInput,
  type ProjectConnectorBinding,
  type ProjectConnectorRoute,
  type ProjectConnectorBindingAvailability,
  type ProjectConnectorBindingChangedField,
  type ProjectConnectorBindingEventDataV1,
  type ProjectConnectorBindingsAggregate,
  type ProjectConnectorCredentialOption
} from "@seo-platform/contracts";
import type {
  IntegrationCredential,
  Prisma
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { safeIntegrationCredentialCapabilities } from "./integration-credential-capabilities.js";
import { safeCredentialQuota } from "./integration-credential.service.js";
import { replaceActiveProjectConnectorRoutes } from "./project-connector-route-lifecycle.js";

const CAPABILITIES = new Set<string>(integrationCapabilities);
const PROVIDERS = new Set<string>(integrationProviders);
const AVAILABILITIES = new Set<string>(
  projectConnectorBindingAvailabilities
);
const FALLBACK_MODES = new Set<string>(connectorFallbackModes);
const FALLBACK_REASONS = new Set<string>(connectorFallbackReasons);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_CREDENTIAL_OPTIONS = 500;

const BINDING_CREDENTIAL_SELECT = {
  id: true,
  workspaceId: true,
  provider: true,
  label: true,
  mode: true,
  status: true,
  capabilities: true,
  providerMeta: true,
  lastSuccessAt: true,
  deletedAt: true
} as const satisfies Prisma.IntegrationCredentialSelect;

const BINDING_INCLUDE = {
  routes: {
    where: { retiredAt: null },
    include: {
      credential: {
        select: BINDING_CREDENTIAL_SELECT
      }
    },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }]
  }
} as const satisfies Prisma.ProjectConnectorBindingInclude;

const WORKSPACE_BINDING_INCLUDE = {
  routes: {
    include: {
      credential: {
        select: BINDING_CREDENTIAL_SELECT
      }
    },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }]
  }
} as const satisfies Prisma.WorkspaceConnectorBindingInclude;

type BindingRecord = Prisma.ProjectConnectorBindingGetPayload<{
  include: typeof BINDING_INCLUDE;
}>;

type WorkspaceBindingRecord = Prisma.WorkspaceConnectorBindingGetPayload<{
  include: typeof WORKSPACE_BINDING_INCLUDE;
}>;

type BindingCredentialRecord = Prisma.IntegrationCredentialGetPayload<{
  select: typeof BINDING_CREDENTIAL_SELECT;
}>;

type CredentialOptionRecord = Pick<
  IntegrationCredential,
  | "id"
  | "workspaceId"
  | "provider"
  | "label"
  | "mode"
  | "status"
  | "capabilities"
  | "providerMeta"
  | "lastSuccessAt"
>;

const CREDENTIAL_OPTION_SELECT = {
  id: true,
  workspaceId: true,
  provider: true,
  label: true,
  mode: true,
  status: true,
  capabilities: true,
  providerMeta: true,
  lastSuccessAt: true
} as const;

@Injectable()
export class ProjectConnectorBindingService {
  public constructor(private readonly prisma: PrismaService) {}

  public async aggregate(
    workspaceId: string,
    projectId: string
  ): Promise<ProjectConnectorBindingsAggregate> {
    return this.prisma.$transaction(
      async (transaction) => {
        const bindings =
          await transaction.projectConnectorBinding.findMany({
            where: { workspaceId, projectId },
            include: BINDING_INCLUDE,
            orderBy: [{ capability: "asc" }, { id: "asc" }]
          });
        const credentials =
          await transaction.integrationCredential.findMany({
            where: { workspaceId, deletedAt: null },
            select: CREDENTIAL_OPTION_SELECT,
            orderBy: [{ label: "asc" }, { id: "asc" }],
            take: MAX_CREDENTIAL_OPTIONS + 1
          });
        const boundedCredentials = boundedCredentialOptions(
          credentials,
          bindings
        );
        return {
          bindings: bindings.map(projectConnectorBindingSummary),
          credentialOptions:
            boundedCredentials.credentials.map(credentialOption),
          credentialOptionsTruncated: boundedCredentials.truncated
        };
      },
      {
        isolationLevel: "RepeatableRead"
      }
    );
  }

  public async create(
    input: InternalCreateProjectConnectorBindingInput,
    requestId: string
  ): Promise<ProjectConnectorBinding> {
    const requestHash = projectConnectorBindingRequestHash(input);
    const replay = await this.findIdempotent(input, requestHash);
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const routes = requestedRoutes(input.route, input.fallbackRoutes);
        assertFallbackConfiguration(input.fallbackPolicy.mode, routes.length);
        await assertRoutesAvailable(
          transaction,
          input.workspaceId,
          routes,
          input.capability
        );
        const binding =
          await transaction.projectConnectorBinding.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              capability: input.capability,
              enabled: input.enabled,
              fallbackMode: input.fallbackPolicy.mode,
              fallbackReasons: fallbackReasonsJson(input.fallbackPolicy.reasons),
              createdBy: input.actorId,
              updatedBy: input.actorId
            }
          });
        await transaction.projectConnectorRoute.createMany({
          data: routes.map((route) => ({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            bindingId: binding.id,
            position: route.position,
            sourceKind: "WORKSPACE_CREDENTIAL",
            credentialId: route.credentialId,
            routingScope: "PROJECT_OVERRIDE"
          }))
        });
        const created = await transaction.projectConnectorBinding.findFirst({
          where: {
            id: binding.id,
            workspaceId: input.workspaceId,
            projectId: input.projectId
          },
          include: BINDING_INCLUDE
        });
        if (!created) {
          throw new Error("Created connector binding projection is missing");
        }
        const summary = projectConnectorBindingSummary(created);
        await writeBindingEvent(
          transaction,
          domainEventTypes.projectConnectorBindingCreated,
          summary,
          undefined,
          input.actorId,
          requestId
        );
        await transaction.projectConnectorBindingCreateReceipt.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            idempotencyKey: input.idempotencyKey,
            requestHash: databaseBytes(requestHash),
            bindingId: summary.id,
            responseSnapshot: bindingSnapshotJson(summary)
          }
        });
        return summary;
      });
    } catch (error) {
      if (isExpectedCreateUniqueConstraintError(error)) {
        const winner = await this.findIdempotent(input, requestHash);
        if (winner) return winner;
        throw bindingAlreadyExists();
      }
      throw error;
    }
  }

  public async update(
    bindingId: string,
    input: InternalUpdateProjectConnectorBindingInput,
    requestId: string
  ): Promise<ProjectConnectorBinding> {
    const current = await this.load(
      bindingId,
      input.workspaceId,
      input.projectId
    );
    if (current.version !== input.version) {
      throw versionConflict(current.version);
    }
    const currentSummary = projectConnectorBindingSummary(current);
    const routes = requestedRoutes(input.route, input.fallbackRoutes);
    assertFallbackConfiguration(input.fallbackPolicy.mode, routes.length);
    const routeChanges = !sameRoutes(bindingRoutes(currentSummary), routes);

    return this.prisma.$transaction(async (transaction) => {
      if (input.enabled || routeChanges) {
        await assertRoutesAvailable(
          transaction,
          input.workspaceId,
          routes,
          currentSummary.capability
        );
      }

      const changed =
        await transaction.projectConnectorBinding.updateMany({
          where: {
            id: bindingId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            version: input.version
          },
          data: {
            enabled: input.enabled,
            configurationScope: "PROJECT_OVERRIDE",
            workspaceBindingId: null,
            workspaceBindingVersion: null,
            fallbackMode: input.fallbackPolicy.mode,
            fallbackReasons: fallbackReasonsJson(input.fallbackPolicy.reasons),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      if (changed.count !== 1) {
        const winner =
          await transaction.projectConnectorBinding.findFirst({
            where: {
              id: bindingId,
              workspaceId: input.workspaceId,
              projectId: input.projectId
            },
            select: { version: true }
          });
        if (!winner) throw bindingNotFound();
        throw versionConflict(winner.version);
      }

      if (routeChanges) {
        await replaceActiveProjectConnectorRoutes(
          transaction,
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            bindingId
          },
          routes.map((route) => ({
            ...route,
            routingScope: "PROJECT_OVERRIDE" as const
          }))
        );
      }

      const updated =
        await transaction.projectConnectorBinding.findFirst({
          where: {
            id: bindingId,
            workspaceId: input.workspaceId,
            projectId: input.projectId
          },
          include: BINDING_INCLUDE
        });
      if (!updated) throw bindingNotFound();
      const summary = projectConnectorBindingSummary(updated);
      await writeBindingEvent(
        transaction,
        domainEventTypes.projectConnectorBindingUpdated,
        summary,
        currentSummary,
        input.actorId,
        requestId
      );
      return summary;
    });
  }

  public async inheritWorkspaceRoute(
    bindingId: string,
    input: InternalInheritProjectConnectorBindingInput,
    requestId: string
  ): Promise<ProjectConnectorBinding> {
    const current = await this.load(
      bindingId,
      input.workspaceId,
      input.projectId
    );
    if (current.version !== input.version) {
      throw versionConflict(current.version);
    }
    const currentSummary = projectConnectorBindingSummary(current);

    return this.prisma.$transaction(async (transaction) => {
      const workspace = await transaction.workspaceConnectorBinding.findUnique({
        where: {
          workspaceId_capability: {
            workspaceId: input.workspaceId,
            capability: current.capability
          }
        },
        include: WORKSPACE_BINDING_INCLUDE
      });
      if (!workspace || workspace.routes.length === 0) {
        throw workspaceRouteUnavailable();
      }
      const changed = await transaction.projectConnectorBinding.updateMany({
        where: {
          id: bindingId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          version: input.version
        },
        data: {
          enabled: workspace.enabled,
          fallbackMode: workspace.fallbackMode,
          fallbackReasons: workspace.fallbackReasons as Prisma.InputJsonValue,
          configurationScope: "WORKSPACE_INHERITED",
          workspaceBindingId: workspace.id,
          workspaceBindingVersion: workspace.version,
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) {
        const winner = await transaction.projectConnectorBinding.findFirst({
          where: {
            id: bindingId,
            workspaceId: input.workspaceId,
            projectId: input.projectId
          },
          select: { version: true }
        });
        if (!winner) throw bindingNotFound();
        throw versionConflict(winner.version);
      }

      await replaceWithWorkspaceRoutes(
        transaction,
        bindingId,
        input.workspaceId,
        input.projectId,
        workspace
      );
      const updated = await transaction.projectConnectorBinding.findFirst({
        where: {
          id: bindingId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        },
        include: BINDING_INCLUDE
      });
      if (!updated) throw bindingNotFound();
      const summary = projectConnectorBindingSummary(updated);
      await writeBindingEvent(
        transaction,
        domainEventTypes.projectConnectorBindingUpdated,
        summary,
        currentSummary,
        input.actorId,
        requestId
      );
      return summary;
    });
  }

  private async load(
    bindingId: string,
    workspaceId: string,
    projectId: string
  ): Promise<BindingRecord> {
    const binding = await this.prisma.projectConnectorBinding.findFirst({
      where: { id: bindingId, workspaceId, projectId },
      include: BINDING_INCLUDE
    });
    if (!binding) throw bindingNotFound();
    return binding;
  }

  private async findIdempotent(
    input: InternalCreateProjectConnectorBindingInput,
    requestHash: Buffer
  ): Promise<ProjectConnectorBinding | null> {
    const receipt =
      await this.prisma.projectConnectorBindingCreateReceipt.findUnique({
        where: {
          workspaceId_projectId_idempotencyKey: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
    if (!receipt) return null;
    if (!requestHashMatches(receipt.requestHash, requestHash)) {
      throw idempotencyConflict();
    }
    const binding = projectConnectorBindingSnapshot(receipt.responseSnapshot);
    if (
      receipt.bindingId !== binding.id ||
      binding.workspaceId !== input.workspaceId ||
      binding.projectId !== input.projectId
    ) {
      throw invalidStoredReceipt();
    }
    return binding;
  }
}

export function projectConnectorBindingRequestHash(
  input: InternalCreateProjectConnectorBindingInput
): Buffer {
  return createHash("sha256")
    .update("seo-platform:project-connector-binding:create:v1", "utf8")
    .update("\0", "utf8")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        capability: input.capability,
        enabled: input.enabled,
        route: input.route,
        fallbackPolicy: input.fallbackPolicy,
        budgetPolicy: input.budgetPolicy
      }),
      "utf8"
    )
    .digest();
}

function projectConnectorBindingSummary(
  binding: BindingRecord
): ProjectConnectorBinding {
  const capability = capabilityValue(binding.capability);
  const routes = binding.routes.map((candidate) => {
    if (
      candidate.workspaceId !== binding.workspaceId ||
      candidate.projectId !== binding.projectId ||
      candidate.bindingId !== binding.id ||
      candidate.position < 0 ||
      candidate.position > 7 ||
      candidate.sourceKind !== "WORKSPACE_CREDENTIAL" ||
      candidate.credential.workspaceId !== binding.workspaceId ||
      candidate.credentialId !== candidate.credential.id
    ) {
      throw new Error("Connector binding route projection is invalid");
    }
    return {
      id: candidate.id,
      bindingId: candidate.bindingId,
      workspaceId: candidate.workspaceId,
      projectId: candidate.projectId,
      position: candidate.position,
      sourceKind: "WORKSPACE_CREDENTIAL" as const,
      credentialId: candidate.credentialId,
      provider: providerValue(candidate.credential.provider),
      credentialMode: candidate.credential.mode,
      routingScope: candidate.routingScope as ConnectorRoutingScope,
      ...(candidate.workspaceRouteId
        ? { workspaceRouteId: candidate.workspaceRouteId }
        : {}),
      createdAt: candidate.createdAt.toISOString(),
      updatedAt: candidate.updatedAt.toISOString()
    };
  });
  if (routes.some((candidate, index) => candidate.position !== index)) {
    throw new Error("Connector binding route positions must be contiguous");
  }
  const primary = routes[0];
  const fallbackMode = fallbackModeValue(binding.fallbackMode);
  const fallbackReasons = fallbackReasonValues(binding.fallbackReasons);
  if (!primary) {
    if (
      binding.enabled ||
      binding.configurationScope !== "PROJECT_OVERRIDE" ||
      binding.workspaceBindingId !== null ||
      binding.workspaceBindingVersion !== null ||
      fallbackMode !== "NONE" ||
      fallbackReasons.length !== 0
    ) {
      throw new Error("Connector binding without routes is not reset");
    }
  }
  return {
    id: binding.id,
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    capability,
    enabled: binding.enabled,
    configurationScope: binding.configurationScope as "PROJECT_OVERRIDE" | "WORKSPACE_INHERITED",
    ...(binding.workspaceBindingId ? { workspaceBindingId: binding.workspaceBindingId } : {}),
    ...(primary ? { route: primary } : {}),
    routes,
    fallbackPolicy: { mode: fallbackMode, reasons: fallbackReasons },
    budgetPolicy: { mode: "DISABLED" },
    availability: bindingAvailabilityForRoutes(
      binding.enabled,
      capability,
      binding.routes,
      fallbackMode
    ),
    version: binding.version,
    createdBy: binding.createdBy,
    updatedBy: binding.updatedBy,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString()
  };
}

function boundedCredentialOptions(
  candidates: readonly CredentialOptionRecord[],
  bindings: readonly BindingRecord[]
): {
  readonly credentials: readonly CredentialOptionRecord[];
  readonly truncated: boolean;
} {
  const truncated = candidates.length > MAX_CREDENTIAL_OPTIONS;
  const selected = new Map<string, CredentialOptionRecord>();
  for (const binding of bindings) {
    for (const route of binding.routes) {
      if (!route.credential.deletedAt) {
        selected.set(route.credential.id, route.credential);
      }
    }
  }
  if (selected.size > MAX_CREDENTIAL_OPTIONS) {
    throw new Error("Too many selected connector credentials");
  }

  const bounded = new Map(
    candidates
      .slice(0, MAX_CREDENTIAL_OPTIONS)
      .map((credential) => [credential.id, credential] as const)
  );
  for (const [credentialId, credential] of selected) {
    if (bounded.has(credentialId)) continue;
    const replaceable = [...bounded.keys()]
      .reverse()
      .find((id) => !selected.has(id));
    if (replaceable) bounded.delete(replaceable);
    bounded.set(credentialId, credential);
  }
  return {
    credentials: [...bounded.values()].sort(compareCredentialOptions),
    truncated
  };
}

function compareCredentialOptions(
  left: CredentialOptionRecord,
  right: CredentialOptionRecord
): number {
  if (left.label < right.label) return -1;
  if (left.label > right.label) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function credentialOption(
  credential: CredentialOptionRecord
): ProjectConnectorCredentialOption {
  const provider = providerValue(credential.provider);
  const quota = safeCredentialQuota(
    provider,
    credential.providerMeta,
    credential.lastSuccessAt
  );
  return {
    id: credential.id,
    workspaceId: credential.workspaceId,
    provider,
    label: credential.label,
    mode: credential.mode,
    status: credential.status,
    capabilities: safeIntegrationCredentialCapabilities(
      provider,
      credential.capabilities
    ),
    ...(quota.status === "AVAILABLE" ? { quota } : {})
  };
}

function bindingAvailability(
  enabled: boolean,
  capability: IntegrationCapability,
  credential: BindingCredentialRecord & {
    readonly provider: IntegrationProvider;
  }
): ProjectConnectorBindingAvailability {
  if (!enabled) return "DISABLED";
  if (credential.deletedAt) return "CREDENTIAL_UNAVAILABLE";
  if (credential.status === "PENDING_VERIFICATION") {
    return "CREDENTIAL_PENDING";
  }
  if (
    credential.status !== "ACTIVE" ||
    credential.mode !== "BYOK_API_KEY"
  ) {
    return "CREDENTIAL_UNAVAILABLE";
  }
  return safeIntegrationCredentialCapabilities(
    credential.provider,
    credential.capabilities
  ).includes(capability)
    ? "READY"
    : "CAPABILITY_MISMATCH";
}

function bindingAvailabilityForRoutes(
  enabled: boolean,
  capability: IntegrationCapability,
  routes: readonly BindingRecord["routes"][number][],
  fallbackMode: ConnectorFallbackMode
): ProjectConnectorBindingAvailability {
  if (!enabled) return "DISABLED";
  const availabilities = routes.map((route) =>
    bindingAvailability(enabled, capability, {
      ...route.credential,
      provider: providerValue(route.credential.provider)
    })
  );
  const primary = availabilities[0] ?? "CREDENTIAL_UNAVAILABLE";
  if (primary === "READY" || fallbackMode === "NONE") return primary;
  return availabilities.slice(1).includes("READY") ? "READY" : primary;
}

function requestedRoutes(
  primary: InternalCreateProjectConnectorBindingInput["route"],
  fallbacks: readonly InternalCreateProjectConnectorBindingInput["route"][] | undefined
): readonly InternalCreateProjectConnectorBindingInput["route"][] {
  const routes = [primary, ...(fallbacks ?? [])];
  if (
    routes.length > 8 ||
    routes.some((route, index) => route.position !== index) ||
    new Set(routes.map(({ credentialId }) => credentialId)).size !== routes.length
  ) {
    throw new ConflictException({
      code: "INVALID_CONNECTOR_ROUTE_CHAIN",
      message: "Connector routes must be unique and have contiguous positions"
    });
  }
  return routes;
}

function sameRoutes(
  current: readonly ProjectConnectorRoute[],
  requested: readonly InternalCreateProjectConnectorBindingInput["route"][]
): boolean {
  return current.length === requested.length && current.every((route, index) =>
    route.position === requested[index]?.position &&
    route.credentialId === requested[index]?.credentialId
  );
}

function bindingRoutes(
  binding: ProjectConnectorBinding
): readonly ProjectConnectorRoute[] {
  return binding.routes ?? (binding.route ? [binding.route] : []);
}

function requiredBindingRoute(
  binding: ProjectConnectorBinding
): ProjectConnectorRoute {
  const route = binding.route ?? binding.routes?.[0];
  if (!route) {
    throw new Error("Configured connector binding primary route is missing");
  }
  return route;
}

function assertFallbackConfiguration(
  mode: ConnectorFallbackMode,
  routeCount: number
): void {
  if (mode === "NONE" && routeCount > 1) {
    throw new ConflictException({
      code: "INVALID_CONNECTOR_FALLBACK",
      message: "Fallback routes require an enabled fallback policy"
    });
  }
  if (mode === "NEXT_AVAILABLE" && routeCount < 2) {
    throw new ConflictException({
      code: "INVALID_CONNECTOR_FALLBACK",
      message: "NEXT_AVAILABLE requires at least two project routes"
    });
  }
}

function fallbackModeValue(value: string): ConnectorFallbackMode {
  if (!FALLBACK_MODES.has(value)) {
    throw new Error("Unsupported connector fallback mode in storage");
  }
  return value as ConnectorFallbackMode;
}

function fallbackReasonValues(value: Prisma.JsonValue): readonly ConnectorFallbackReason[] {
  if (
    !Array.isArray(value) ||
    value.some((reason) => typeof reason !== "string" || !FALLBACK_REASONS.has(reason)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Invalid connector fallback reasons in storage");
  }
  return value as ConnectorFallbackReason[];
}

function fallbackReasonsJson(
  reasons: readonly ConnectorFallbackReason[] | undefined
): Prisma.InputJsonValue {
  return [...(reasons ?? [])];
}

async function replaceWithWorkspaceRoutes(
  transaction: Prisma.TransactionClient,
  bindingId: string,
  workspaceId: string,
  projectId: string,
  workspace: WorkspaceBindingRecord
): Promise<void> {
  await replaceActiveProjectConnectorRoutes(
    transaction,
    { bindingId, workspaceId, projectId },
    workspace.routes.map((route, position) => ({
      position,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: route.credentialId,
      routingScope: "WORKSPACE_DEFAULT",
      workspaceRouteId: route.id
    }))
  );
}

async function assertRoutesAvailable(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  routes: readonly InternalCreateProjectConnectorBindingInput["route"][],
  capability: IntegrationCapability
): Promise<void> {
  for (const route of routes) {
    await assertCredentialAvailable(
      transaction,
      workspaceId,
      route.credentialId,
      capability
    );
  }
}

async function assertCredentialAvailable(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  credentialId: string,
  capability: IntegrationCapability
): Promise<void> {
  const credentials = await transaction.$queryRaw<BindingCredentialRecord[]>`
    SELECT
      "id",
      "workspace_id" AS "workspaceId",
      "provider",
      "mode",
      "status",
      "capabilities",
      "deleted_at" AS "deletedAt"
    FROM "integration_credentials"
    WHERE
      "workspace_id" = CAST(${workspaceId} AS UUID)
      AND "id" = CAST(${credentialId} AS UUID)
      AND "deleted_at" IS NULL
    FOR SHARE
  `;
  const credential = credentials[0];
  if (!credential) throw credentialUnavailable();
  const provider = providerValue(credential.provider);
  if (
    credential.status !== "ACTIVE" ||
    credential.mode !== "BYOK_API_KEY" ||
    !safeIntegrationCredentialCapabilities(
      provider,
      credential.capabilities
    ).includes(capability)
  ) {
    throw credentialUnavailable();
  }
}

async function writeBindingEvent(
  transaction: Prisma.TransactionClient,
  eventType:
    | typeof domainEventTypes.projectConnectorBindingCreated
    | typeof domainEventTypes.projectConnectorBindingUpdated,
  binding: ProjectConnectorBinding,
  previous: ProjectConnectorBinding | undefined,
  actorId: string,
  requestId: string
): Promise<void> {
  const primary = requiredBindingRoute(binding);
  const payload = {
    bindingId: binding.id,
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    capability: binding.capability,
    enabled: binding.enabled,
    route: {
      position: primary.position,
      sourceKind: primary.sourceKind,
      provider: primary.provider,
      credentialMode: primary.credentialMode
    },
    routes: bindingRoutes(binding).map((route) => ({
      position: route.position,
      sourceKind: route.sourceKind,
      provider: route.provider,
      credentialMode: route.credentialMode
    })),
    fallbackMode: binding.fallbackPolicy.mode,
    budgetMode: binding.budgetPolicy.mode,
    availability: binding.availability,
    version: binding.version,
    changedBy: actorId,
    changedFields: bindingChangedFields(previous, binding)
  } satisfies ProjectConnectorBindingEventDataV1;
  await transaction.outboxEvent.create({
    data: {
      eventType,
      aggregateId: binding.id,
      workspaceId: binding.workspaceId,
      projectId: binding.projectId,
      payload,
      metadata: {
        producer: "jobs-integrations",
        requestId
      }
    }
  });
}

function bindingChangedFields(
  previous: ProjectConnectorBinding | undefined,
  current: ProjectConnectorBinding
): ProjectConnectorBindingChangedField[] {
  if (!previous) return [...projectConnectorBindingChangedFields];

  const fields: ProjectConnectorBindingChangedField[] = [];
  if (previous.enabled !== current.enabled) fields.push("enabled");
  if (!samePublicRoutes(bindingRoutes(previous), bindingRoutes(current))) {
    fields.push("route");
  }
  if (
    previous.fallbackPolicy.mode !== current.fallbackPolicy.mode ||
    JSON.stringify(previous.fallbackPolicy.reasons ?? []) !==
      JSON.stringify(current.fallbackPolicy.reasons ?? [])
  ) {
    fields.push("fallbackPolicy");
  }
  if (previous.budgetPolicy.mode !== current.budgetPolicy.mode) {
    fields.push("budgetPolicy");
  }
  return fields;
}

function samePublicRoutes(
  left: readonly ProjectConnectorRoute[],
  right: readonly ProjectConnectorRoute[]
): boolean {
  return left.length === right.length && left.every((route, index) => {
    const candidate = right[index];
    return candidate !== undefined &&
      route.position === candidate.position &&
      route.credentialId === candidate.credentialId &&
      route.provider === candidate.provider &&
      route.credentialMode === candidate.credentialMode;
  });
}

function capabilityValue(value: string): IntegrationCapability {
  if (!CAPABILITIES.has(value)) {
    throw new Error("Unsupported capability in connector binding storage");
  }
  return value as IntegrationCapability;
}

function providerValue(value: string): IntegrationProvider {
  if (!PROVIDERS.has(value)) {
    throw new Error("Unsupported provider in integration storage");
  }
  return value as IntegrationProvider;
}

function requestHashMatches(
  stored: Uint8Array,
  candidate: Buffer
): boolean {
  const value = Buffer.from(stored);
  return (
    value.length === candidate.length && timingSafeEqual(value, candidate)
  );
}

function bindingSnapshotJson(
  binding: ProjectConnectorBinding
): Prisma.InputJsonValue {
  const primary = requiredBindingRoute(binding);
  return {
    id: binding.id,
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    capability: binding.capability,
    enabled: binding.enabled,
    route: {
      id: primary.id,
      bindingId: primary.bindingId,
      workspaceId: primary.workspaceId,
      projectId: primary.projectId,
      position: primary.position,
      sourceKind: primary.sourceKind,
      credentialId: primary.credentialId,
      provider: primary.provider,
      credentialMode: primary.credentialMode,
      createdAt: primary.createdAt,
      updatedAt: primary.updatedAt
    },
    routes: bindingRoutes(binding).map((route) => ({
      id: route.id,
      bindingId: route.bindingId,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      position: route.position,
      sourceKind: route.sourceKind,
      credentialId: route.credentialId,
      provider: route.provider,
      credentialMode: route.credentialMode,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt
    })),
    fallbackPolicy: {
      mode: binding.fallbackPolicy.mode,
      reasons: [...(binding.fallbackPolicy.reasons ?? [])]
    },
    budgetPolicy: { mode: binding.budgetPolicy.mode },
    availability: binding.availability,
    version: binding.version,
    createdBy: binding.createdBy,
    updatedBy: binding.updatedBy,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt
  };
}

function projectConnectorBindingSnapshot(
  value: Prisma.JsonValue
): ProjectConnectorBinding {
  const requiredFields = [
    "id",
    "workspaceId",
    "projectId",
    "capability",
    "enabled",
    "route",
    "fallbackPolicy",
    "budgetPolicy",
    "availability",
    "version",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt"
  ] as const;
  const binding = exactStoredRecordWithOptional(
    value,
    requiredFields,
    ["routes"]
  );
  const route = projectConnectorRouteSnapshot(binding.route);
  const routes = binding.routes === undefined
    ? [route]
    : storedRouteList(binding.routes);
  const fallback = exactStoredRecordWithOptional(
    binding.fallbackPolicy,
    ["mode"],
    ["reasons"]
  );
  const budget = exactStoredRecord(binding.budgetPolicy, ["mode"]);
  const id = storedUuid(binding.id);
  const workspaceId = storedUuid(binding.workspaceId);
  const projectId = storedUuid(binding.projectId);
  const availability = storedString(binding.availability);
  const fallbackMode = storedString(fallback.mode);
  const fallbackReasonValues = storedFallbackReasons(fallback.reasons);
  if (
    (binding.enabled !== true && binding.enabled !== false) ||
    !Number.isSafeInteger(binding.version) ||
    Number(binding.version) < 1 ||
    budget.mode !== "DISABLED" ||
    !AVAILABILITIES.has(availability) ||
    !FALLBACK_MODES.has(fallbackMode) ||
    routes.length < 1 ||
    routes.length > 8 ||
    routes[0]?.id !== route.id ||
    routes.some((candidate, index) => candidate.position !== index) ||
    (fallbackMode === "NONE" &&
      (routes.length !== 1 || fallbackReasonValues.length > 0)) ||
    (fallbackMode !== "NONE" && routes.length < 2)
  ) {
    throw invalidStoredReceipt();
  }
  if (
    routes.some(
      (candidate) =>
        candidate.bindingId !== id ||
        candidate.workspaceId !== workspaceId ||
        candidate.projectId !== projectId
    )
  ) {
    throw invalidStoredReceipt();
  }
  return {
    id,
    workspaceId,
    projectId,
    capability: capabilityValue(storedString(binding.capability)),
    enabled: binding.enabled,
    route,
    routes,
    fallbackPolicy: {
      mode: fallbackMode as ConnectorFallbackMode,
      reasons: fallbackReasonValues
    },
    budgetPolicy: { mode: "DISABLED" },
    availability:
      availability as ProjectConnectorBindingAvailability,
    version: Number(binding.version),
    createdBy: storedUuid(binding.createdBy),
    updatedBy: storedUuid(binding.updatedBy),
    createdAt: storedTimestamp(binding.createdAt),
    updatedAt: storedTimestamp(binding.updatedAt)
  };
}

function projectConnectorRouteSnapshot(
  value: unknown
): ProjectConnectorRoute {
  const route = exactStoredRecord(value, [
    "id",
    "bindingId",
    "workspaceId",
    "projectId",
    "position",
    "sourceKind",
    "credentialId",
    "provider",
    "credentialMode",
    "createdAt",
    "updatedAt"
  ]);
  const credentialMode = storedString(route.credentialMode);
  if (
    !Number.isSafeInteger(route.position) ||
    Number(route.position) < 0 ||
    route.sourceKind !== "WORKSPACE_CREDENTIAL" ||
    credentialMode !== "BYOK_API_KEY"
  ) {
    throw invalidStoredReceipt();
  }
  return {
    id: storedUuid(route.id),
    bindingId: storedUuid(route.bindingId),
    workspaceId: storedUuid(route.workspaceId),
    projectId: storedUuid(route.projectId),
    position: Number(route.position),
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId: storedUuid(route.credentialId),
    provider: providerValue(storedString(route.provider)),
    credentialMode:
      credentialMode as ProjectConnectorRoute["credentialMode"],
    createdAt: storedTimestamp(route.createdAt),
    updatedAt: storedTimestamp(route.updatedAt)
  };
}

function storedRouteList(value: unknown): readonly ProjectConnectorRoute[] {
  if (!Array.isArray(value)) throw invalidStoredReceipt();
  return value.map(projectConnectorRouteSnapshot);
}

function storedFallbackReasons(
  value: unknown
): readonly ConnectorFallbackReason[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (reason) => typeof reason !== "string" || !FALLBACK_REASONS.has(reason)
    )
  ) {
    throw invalidStoredReceipt();
  }
  return value as ConnectorFallbackReason[];
}

function exactStoredRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidStoredReceipt();
  }
  const record = value as Readonly<Record<string, unknown>>;
  const expected = new Set(fields);
  if (
    Object.keys(record).length !== fields.length ||
    Object.keys(record).some((field) => !expected.has(field)) ||
    fields.some((field) => !(field in record))
  ) {
    throw invalidStoredReceipt();
  }
  return record;
}

function exactStoredRecordWithOptional(
  value: unknown,
  requiredFields: readonly string[],
  optionalFields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidStoredReceipt();
  }
  const record = value as Readonly<Record<string, unknown>>;
  const allowed = new Set([...requiredFields, ...optionalFields]);
  if (
    Object.keys(record).some((field) => !allowed.has(field)) ||
    requiredFields.some((field) => !(field in record))
  ) {
    throw invalidStoredReceipt();
  }
  return record;
}

function storedString(value: unknown): string {
  if (typeof value !== "string" || !value) throw invalidStoredReceipt();
  return value;
}

function storedUuid(value: unknown): string {
  const id = storedString(value);
  if (!UUID_PATTERN.test(id) || id !== id.toLowerCase()) {
    throw invalidStoredReceipt();
  }
  return id;
}

function storedTimestamp(value: unknown): string {
  const timestamp = storedString(value);
  const parsed = new Date(timestamp);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== timestamp
  ) {
    throw invalidStoredReceipt();
  }
  return timestamp;
}

function invalidStoredReceipt(): Error {
  return new Error("Invalid project connector binding create receipt");
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function isExpectedCreateUniqueConstraintError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002" ||
    !("meta" in error) ||
    typeof error.meta !== "object" ||
    error.meta === null ||
    !("target" in error.meta)
  ) {
    return false;
  }
  const target = error.meta.target;
  if (typeof target === "string") {
    return [
      "project_connector_bindings_tenant_project_capability_key",
      "project_connector_binding_create_receipts_pkey"
    ].includes(target);
  }
  if (
    !Array.isArray(target) ||
    target.some((field) => typeof field !== "string")
  ) {
    return false;
  }
  return [
    "workspaceId,projectId,capability",
    "workspace_id,project_id,capability",
    "workspaceId,projectId,idempotencyKey",
    "workspace_id,project_id,idempotency_key"
  ].includes(target.join(","));
}

function bindingNotFound(): NotFoundException {
  return new NotFoundException({
    code: "NOT_FOUND",
    message: "Project connector binding not found"
  });
}

function bindingAlreadyExists(): ConflictException {
  return new ConflictException({
    code: "DUPLICATE",
    message: "A binding already exists for this project capability"
  });
}

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: "IDEMPOTENCY_CONFLICT",
    message:
      "Idempotency key was already used for another connector binding request"
  });
}

function credentialUnavailable(): ConflictException {
  return new ConflictException({
    code: "RESOURCE_STATE_CONFLICT",
    message:
      "Credential is not active or does not support the requested capability"
  });
}

function workspaceRouteUnavailable(): ConflictException {
  return new ConflictException({
    code: "CONNECTOR_NOT_READY",
    message: "Workspace route is not configured for this capability"
  });
}

function versionConflict(currentVersion: number): PreconditionFailedException {
  return new PreconditionFailedException({
    code: "VERSION_CONFLICT",
    message: "Project connector binding version conflict",
    currentVersion
  });
}
