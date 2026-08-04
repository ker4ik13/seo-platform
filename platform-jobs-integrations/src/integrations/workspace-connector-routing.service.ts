import {
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException
} from "@nestjs/common";
import {
  connectorFallbackReasons,
  integrationCapabilities,
  integrationProviders,
  type ConnectorFallbackReason,
  type ConnectorOperationAttemptSummary,
  type ConnectorRoutingScope,
  type IntegrationCapability,
  type IntegrationProvider,
  type InternalUpsertWorkspaceConnectorBindingInput,
  type ProjectConnectorBindingAvailability,
  type ProjectConnectorCredentialOption,
  type WorkspaceConnectorBinding,
  type WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import { Prisma, type CredentialStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { safeIntegrationCredentialCapabilities } from "./integration-credential-capabilities.js";
import { safeCredentialQuota } from "./integration-credential.service.js";

const CAPABILITIES = new Set<string>(integrationCapabilities);
const PROVIDERS = new Set<string>(integrationProviders);
const FALLBACK_REASONS = new Set<string>(connectorFallbackReasons);
const MAX_CREDENTIAL_OPTIONS = 500;

const CREDENTIAL_SELECT = {
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

const WORKSPACE_BINDING_INCLUDE = {
  routes: {
    include: { credential: { select: CREDENTIAL_SELECT } },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }]
  }
} as const satisfies Prisma.WorkspaceConnectorBindingInclude;

const PROJECT_BINDING_INCLUDE = {
  routes: {
    include: { credential: { select: CREDENTIAL_SELECT } },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }]
  }
} as const satisfies Prisma.ProjectConnectorBindingInclude;

type WorkspaceBindingRecord = Prisma.WorkspaceConnectorBindingGetPayload<{
  include: typeof WORKSPACE_BINDING_INCLUDE;
}>;
type ProjectBindingRecord = Prisma.ProjectConnectorBindingGetPayload<{
  include: typeof PROJECT_BINDING_INCLUDE;
}>;
type CredentialRecord = Prisma.IntegrationCredentialGetPayload<{
  select: typeof CREDENTIAL_SELECT;
}>;

export interface ResolvedConnectorRoute {
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly routeId: string;
  readonly credentialId: string;
  readonly provider: IntegrationProvider;
  readonly credentialMode: ProjectConnectorCredentialOption["mode"];
  readonly routingScope: ConnectorRoutingScope;
  readonly position: number;
  readonly attempts: readonly ConnectorOperationAttemptSummary[];
}

@Injectable()
export class WorkspaceConnectorRoutingService {
  public constructor(private readonly prisma: PrismaService) {}

  public async settings(workspaceId: string): Promise<WorkspaceConnectorRoutingSettings> {
    const [bindings, credentials] = await this.prisma.$transaction([
      this.prisma.workspaceConnectorBinding.findMany({
        where: { workspaceId },
        include: WORKSPACE_BINDING_INCLUDE,
        orderBy: [{ capability: "asc" }, { id: "asc" }]
      }),
      this.prisma.integrationCredential.findMany({
        where: { workspaceId, deletedAt: null },
        select: CREDENTIAL_SELECT,
        orderBy: [{ label: "asc" }, { id: "asc" }],
        take: MAX_CREDENTIAL_OPTIONS + 1
      })
    ]);
    return {
      bindings: bindings.map(workspaceBindingSummary),
      credentialOptions: credentials
        .slice(0, MAX_CREDENTIAL_OPTIONS)
        .map(credentialOption),
      credentialOptionsTruncated: credentials.length > MAX_CREDENTIAL_OPTIONS,
      access: { canUpdateBindings: false, canManageFallback: false }
    };
  }

  public async upsert(
    input: InternalUpsertWorkspaceConnectorBindingInput
  ): Promise<WorkspaceConnectorBinding> {
    assertCapability(input.capability);
    assertWorkspaceRoutes(input);
    return this.prisma.$transaction(async (transaction) => {
      const credentials = await lockedCredentials(
        transaction,
        input.workspaceId,
        input.routes.map(({ credentialId }) => credentialId)
      );
      for (const route of input.routes) {
        const credential = credentials.get(route.credentialId);
        if (!credential || routeAvailability(input.capability, credential) !== "READY") {
          throw connectorNotReady();
        }
      }

      const current = await transaction.workspaceConnectorBinding.findUnique({
        where: {
          workspaceId_capability: {
            workspaceId: input.workspaceId,
            capability: input.capability
          }
        }
      });
      if (current && input.version !== undefined && current.version !== input.version) {
        throw versionConflict(current.version);
      }
      const binding = current
        ? await transaction.workspaceConnectorBinding.update({
            where: { id: current.id },
            data: {
              enabled: input.enabled,
              fallbackMode: input.fallbackPolicy.mode,
              fallbackReasons: [...(input.fallbackPolicy.reasons ?? [])],
              updatedBy: input.actorId,
              version: { increment: 1 }
            }
          })
        : await transaction.workspaceConnectorBinding.create({
            data: {
              workspaceId: input.workspaceId,
              capability: input.capability,
              enabled: input.enabled,
              fallbackMode: input.fallbackPolicy.mode,
              fallbackReasons: [...(input.fallbackPolicy.reasons ?? [])],
              createdBy: input.actorId,
              updatedBy: input.actorId
            }
          });

      await transaction.workspaceConnectorRoute.deleteMany({
        where: { workspaceId: input.workspaceId, bindingId: binding.id }
      });
      await transaction.workspaceConnectorRoute.createMany({
        data: input.routes.map((route) => ({
          workspaceId: input.workspaceId,
          bindingId: binding.id,
          position: route.position,
          credentialId: route.credentialId
        }))
      });
      const saved = await transaction.workspaceConnectorBinding.findFirst({
        where: { id: binding.id, workspaceId: input.workspaceId },
        include: WORKSPACE_BINDING_INCLUDE
      });
      if (!saved) throw new Error("Workspace connector binding projection is missing");
      return workspaceBindingSummary(saved);
    });
  }

  /**
   * Resolves the effective route without exposing credentials. Project routes
   * win; an absent override inherits the workspace chain. A project may opt
   * into appending the workspace chain after its own routes.
   */
  public async resolve(
    workspaceId: string,
    projectId: string,
    capability: IntegrationCapability,
    actorId: string,
    requestedProvider?: IntegrationProvider,
    requestedCredentialId?: string
  ): Promise<ResolvedConnectorRoute> {
    const project = await this.ensureEffectiveProjectBinding(
      workspaceId,
      projectId,
      capability,
      actorId
    );
    const allCandidates = projectCandidates(project);
    const requestedIndex = requestedCredentialId !== undefined
      ? allCandidates.findIndex(
          (candidate) =>
            candidate.route.credentialId === requestedCredentialId &&
            (requestedProvider === undefined ||
              provider(candidate.route.credential.provider) === requestedProvider)
        )
      : requestedProvider === undefined
        ? 0
        : allCandidates.findIndex(
            (candidate) =>
              provider(candidate.route.credential.provider) === requestedProvider
          );
    const candidates = requestedIndex < 0
      ? []
      : allCandidates.slice(requestedIndex);
    const attempts: ConnectorOperationAttemptSummary[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const availability = routeAvailability(capability, candidate.route.credential);
      if (availability === "READY") {
        attempts.push(attempt(index + 1, candidate, "SELECTED"));
        return {
          bindingId: candidate.binding.id,
          bindingVersion: candidate.binding.version,
          routeId: candidate.route.id,
          credentialId: candidate.route.credentialId,
          provider: provider(candidate.route.credential.provider),
          credentialMode: candidate.route.credential.mode,
          routingScope: candidate.scope,
          position: candidate.route.position,
          attempts
        };
      }
      const reason = fallbackReason(candidate.route.credential.status);
      attempts.push(attempt(index + 1, candidate, "FALLBACK", reason));
      if (!candidate.allowedReasons.includes(reason)) break;
    }
    throw connectorNotReady();
  }

  /**
   * Runtime workers historically execute only project-scoped routes. The
   * effective workspace chain is therefore materialised as a safe reference
   * graph; secret material remains owned by IntegrationCredential.
   */
  public async ensureEffectiveProjectBinding(
    workspaceId: string,
    projectId: string,
    capability: IntegrationCapability,
    actorId: string
  ): Promise<ProjectBindingRecord> {
    assertCapability(capability);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const [current, workspace] = await Promise.all([
          transaction.projectConnectorBinding.findUnique({
            where: {
              workspaceId_projectId_capability: {
                workspaceId,
                projectId,
                capability
              }
            },
            include: PROJECT_BINDING_INCLUDE
          }),
          transaction.workspaceConnectorBinding.findUnique({
            where: { workspaceId_capability: { workspaceId, capability } },
            include: WORKSPACE_BINDING_INCLUDE
          })
        ]);

        if (current?.configurationScope === "PROJECT_OVERRIDE") {
          return syncWorkspaceFallback(
            transaction,
            current,
            workspace,
            actorId
          );
        }
        if (!workspace?.enabled || workspace.routes.length === 0) {
          if (current) return current;
          throw connectorNotReady();
        }
        return syncInheritedProjectBinding(
          transaction,
          current,
          workspace,
          projectId,
          actorId
        );
      });
    } catch (error) {
      if (!uniqueConstraint(error)) throw error;
      const winner = await this.prisma.projectConnectorBinding.findUnique({
        where: {
          workspaceId_projectId_capability: { workspaceId, projectId, capability }
        },
        include: PROJECT_BINDING_INCLUDE
      });
      if (!winner) throw error;
      return winner;
    }
  }
}

type Candidate = {
  readonly binding: ProjectBindingRecord | WorkspaceBindingRecord;
  readonly route: ProjectBindingRecord["routes"][number] | WorkspaceBindingRecord["routes"][number];
  readonly scope: ConnectorRoutingScope;
  readonly allowedReasons: readonly ConnectorFallbackReason[];
};

type RoutingTransaction = Prisma.TransactionClient;

async function syncInheritedProjectBinding(
  transaction: RoutingTransaction,
  current: ProjectBindingRecord | null,
  workspace: WorkspaceBindingRecord,
  projectId: string,
  actorId: string
): Promise<ProjectBindingRecord> {
  if (
    current?.configurationScope === "WORKSPACE_INHERITED" &&
    current.workspaceBindingId === workspace.id &&
    current.workspaceBindingVersion === workspace.version &&
    current.enabled === workspace.enabled
  ) {
    return current;
  }
  const binding = current
    ? await transaction.projectConnectorBinding.update({
        where: { id: current.id },
        data: {
          enabled: workspace.enabled,
          fallbackMode: workspace.fallbackMode,
          fallbackReasons: workspace.fallbackReasons as Prisma.InputJsonValue,
          configurationScope: "WORKSPACE_INHERITED",
          workspaceBindingId: workspace.id,
          workspaceBindingVersion: workspace.version,
          updatedBy: actorId,
          version: { increment: 1 }
        }
      })
    : await transaction.projectConnectorBinding.create({
        data: {
          workspaceId: workspace.workspaceId,
          projectId,
          capability: workspace.capability,
          enabled: workspace.enabled,
          fallbackMode: workspace.fallbackMode,
          fallbackReasons: workspace.fallbackReasons as Prisma.InputJsonValue,
          configurationScope: "WORKSPACE_INHERITED",
          workspaceBindingId: workspace.id,
          workspaceBindingVersion: workspace.version,
          createdBy: actorId,
          updatedBy: actorId
        }
      });
  await replaceMaterializedRoutes(
    transaction,
    binding.id,
    workspace.workspaceId,
    projectId,
    [],
    workspace.routes,
    "WORKSPACE_DEFAULT"
  );
  return requiredProjectBinding(transaction, binding.id, workspace.workspaceId, projectId);
}

async function syncWorkspaceFallback(
  transaction: RoutingTransaction,
  project: ProjectBindingRecord,
  workspace: WorkspaceBindingRecord | null,
  actorId: string
): Promise<ProjectBindingRecord> {
  const overrideRoutes = project.routes.filter(
    ({ routingScope: value }) => value === "PROJECT_OVERRIDE"
  );
  const fallbackRoutes =
    project.fallbackMode === "NEXT_AVAILABLE_THEN_WORKSPACE" && workspace?.enabled
      ? workspace.routes.slice(0, Math.max(0, 8 - overrideRoutes.length))
      : [];
  const storedFallback = project.routes.filter(
    ({ routingScope: value }) => value !== "PROJECT_OVERRIDE"
  );
  if (sameWorkspaceRoutes(storedFallback, fallbackRoutes, overrideRoutes.length)) {
    return project;
  }
  await replaceMaterializedRoutes(
    transaction,
    project.id,
    project.workspaceId,
    project.projectId,
    overrideRoutes,
    fallbackRoutes,
    "WORKSPACE_FALLBACK"
  );
  await transaction.projectConnectorBinding.update({
    where: { id: project.id },
    data: { updatedBy: actorId, version: { increment: 1 } }
  });
  return requiredProjectBinding(
    transaction,
    project.id,
    project.workspaceId,
    project.projectId
  );
}

async function replaceMaterializedRoutes(
  transaction: RoutingTransaction,
  bindingId: string,
  workspaceId: string,
  projectId: string,
  retainedRoutes: readonly ProjectBindingRecord["routes"][number][],
  workspaceRoutes: readonly WorkspaceBindingRecord["routes"][number][],
  scope: "WORKSPACE_DEFAULT" | "WORKSPACE_FALLBACK"
): Promise<void> {
  const retainedIds = retainedRoutes.map(({ id }) => id);
  await transaction.projectConnectorRoute.deleteMany({
    where: {
      workspaceId,
      projectId,
      bindingId,
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {})
    }
  });
  if (workspaceRoutes.length === 0) return;
  await transaction.projectConnectorRoute.createMany({
    data: workspaceRoutes.map((route, index) => ({
      workspaceId,
      projectId,
      bindingId,
      position: retainedRoutes.length + index,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: route.credentialId,
      routingScope: scope,
      workspaceRouteId: route.id
    }))
  });
}

function sameWorkspaceRoutes(
  stored: readonly ProjectBindingRecord["routes"][number][],
  desired: readonly WorkspaceBindingRecord["routes"][number][],
  offset: number
): boolean {
  return stored.length === desired.length && stored.every((route, index) =>
    route.position === offset + index &&
    route.workspaceRouteId === desired[index]?.id &&
    route.credentialId === desired[index]?.credentialId &&
    route.routingScope === "WORKSPACE_FALLBACK"
  );
}

async function requiredProjectBinding(
  transaction: RoutingTransaction,
  bindingId: string,
  workspaceId: string,
  projectId: string
): Promise<ProjectBindingRecord> {
  const binding = await transaction.projectConnectorBinding.findFirst({
    where: { id: bindingId, workspaceId, projectId },
    include: PROJECT_BINDING_INCLUDE
  });
  if (!binding) throw new Error("Effective project connector binding is missing");
  return binding;
}

function projectCandidates(project: ProjectBindingRecord): readonly Candidate[] {
  if (!project.enabled) return [];
  return project.routes
    .slice(0, project.fallbackMode === "NONE" ? 1 : undefined)
    .map((route) => ({
      binding: project,
      route,
      scope: routingScope(route.routingScope),
      allowedReasons: fallbackReasons(project.fallbackReasons)
    }));
}

function workspaceBindingSummary(binding: WorkspaceBindingRecord): WorkspaceConnectorBinding {
  const bindingCapability = capability(binding.capability);
  return {
    id: binding.id,
    workspaceId: binding.workspaceId,
    capability: bindingCapability,
    enabled: binding.enabled,
    routes: binding.routes.map((route) => ({
      id: route.id,
      bindingId: route.bindingId,
      workspaceId: route.workspaceId,
      position: route.position,
      credentialId: route.credentialId,
      provider: provider(route.credential.provider),
      credentialMode: route.credential.mode,
      availability: routeAvailability(bindingCapability, route.credential),
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString()
    })),
    fallbackPolicy: {
      mode: binding.fallbackMode === "NEXT_AVAILABLE" ? "NEXT_AVAILABLE" : "NONE",
      reasons: fallbackReasons(binding.fallbackReasons)
    },
    version: binding.version,
    createdBy: binding.createdBy,
    updatedBy: binding.updatedBy,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString()
  };
}

function credentialOption(credential: CredentialRecord): ProjectConnectorCredentialOption {
  const currentProvider = provider(credential.provider);
  const quota = safeCredentialQuota(
    currentProvider,
    credential.providerMeta,
    credential.lastSuccessAt
  );
  return {
    id: credential.id,
    workspaceId: credential.workspaceId,
    provider: currentProvider,
    label: credential.label,
    mode: credential.mode,
    status: credential.status,
    capabilities: safeIntegrationCredentialCapabilities(currentProvider, credential.capabilities),
    ...(quota.status === "AVAILABLE" ? { quota } : {})
  };
}

function routeAvailability(
  capabilityValue: IntegrationCapability,
  credential: CredentialRecord
): ProjectConnectorBindingAvailability {
  if (credential.deletedAt) return "CREDENTIAL_UNAVAILABLE";
  if (credential.status === "PENDING_VERIFICATION") return "CREDENTIAL_PENDING";
  if (credential.status !== "ACTIVE" || credential.mode !== "BYOK_API_KEY") {
    return "CREDENTIAL_UNAVAILABLE";
  }
  return safeIntegrationCredentialCapabilities(
    provider(credential.provider),
    credential.capabilities
  ).includes(capabilityValue)
    ? "READY"
    : "CAPABILITY_MISMATCH";
}

async function lockedCredentials(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  ids: readonly string[]
): Promise<Map<string, CredentialRecord>> {
  const rows = await transaction.integrationCredential.findMany({
    where: { workspaceId, id: { in: [...ids] }, deletedAt: null },
    select: CREDENTIAL_SELECT
  });
  return new Map(rows.map((row) => [row.id, row]));
}

function assertWorkspaceRoutes(input: InternalUpsertWorkspaceConnectorBindingInput): void {
  const reasons = input.fallbackPolicy.reasons ?? [];
  if (
    input.routes.length < 1 ||
    input.routes.length > 8 ||
    input.routes.some((route, index) => route.position !== index) ||
    new Set(input.routes.map(({ credentialId }) => credentialId)).size !== input.routes.length ||
    reasons.some((reason) => !FALLBACK_REASONS.has(reason)) ||
    input.fallbackPolicy.mode === "NEXT_AVAILABLE_THEN_WORKSPACE" ||
    (input.fallbackPolicy.mode === "NONE" && (input.routes.length !== 1 || reasons.length > 0)) ||
    (input.fallbackPolicy.mode === "NEXT_AVAILABLE" && input.routes.length < 2)
  ) {
    throw new ConflictException({
      code: "INVALID_CONNECTOR_ROUTE_CHAIN",
      message: "Workspace connector route chain is invalid"
    });
  }
}

function fallbackReasons(value: Prisma.JsonValue): readonly ConnectorFallbackReason[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !FALLBACK_REASONS.has(item))) {
    throw new Error("Invalid connector fallback reasons in storage");
  }
  return value as unknown as ConnectorFallbackReason[];
}

function fallbackReason(status: CredentialStatus): ConnectorFallbackReason {
  if (status === "LOW_BALANCE") return "LOW_BALANCE";
  if (status === "RATE_LIMITED") return "RATE_LIMITED";
  if (status === "DEGRADED") return "RETRYABLE_PROVIDER_ERROR";
  return "CREDENTIAL_UNAVAILABLE";
}

function attempt(
  sequence: number,
  candidate: Candidate,
  outcome: ConnectorOperationAttemptSummary["outcome"],
  reasonCode?: string
): ConnectorOperationAttemptSummary {
  return {
    sequence,
    provider: provider(candidate.route.credential.provider),
    routingScope: candidate.scope,
    outcome,
    ...(reasonCode ? { reasonCode } : {}),
    occurredAt: new Date().toISOString()
  };
}

function capability(value: string): IntegrationCapability {
  assertCapability(value);
  return value as IntegrationCapability;
}

function assertCapability(value: string): void {
  if (!CAPABILITIES.has(value)) throw new NotFoundException("Integration capability not found");
}

function provider(value: string): IntegrationProvider {
  if (!PROVIDERS.has(value)) throw new Error("Unsupported integration provider in storage");
  return value as IntegrationProvider;
}

function routingScope(value: string): ConnectorRoutingScope {
  if (
    value !== "WORKSPACE_DEFAULT" &&
    value !== "PROJECT_OVERRIDE" &&
    value !== "WORKSPACE_FALLBACK"
  ) {
    throw new Error("Unsupported connector routing scope in storage");
  }
  return value;
}

function uniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function connectorNotReady(): ConflictException {
  return new ConflictException({
    code: "CONNECTOR_NOT_READY",
    message: "No active integration route can execute this operation"
  });
}

function versionConflict(currentVersion: number): PreconditionFailedException {
  return new PreconditionFailedException({
    code: "VERSION_CONFLICT",
    message: "Workspace connector binding version conflict",
    currentVersion
  });
}
