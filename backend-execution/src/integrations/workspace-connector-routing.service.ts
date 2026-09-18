import { credentialModeSupportsCapability } from "@seo-platform/contracts";
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
  type XmlStockOperationProduct,
  type XmlStockPricingSummary,
  type WorkspaceConnectorBinding,
  type WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { safeIntegrationCredentialCapabilities } from "./integration-credential-capabilities.js";
import { safeCredentialQuota } from "./integration-credential.service.js";
import { xmlStockOperationUsage } from "./xmlstock-pricing.js";
import { replaceActiveProjectConnectorRoutes } from "./project-connector-route-lifecycle.js";

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
    where: { retiredAt: null },
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
  readonly xmlStockPricing?: XmlStockPricingSummary;
}

export interface ConnectorRouteRequirement {
  readonly xmlStock?: {
    readonly product: XmlStockOperationProduct;
    readonly requestCount: number;
  };
}

@Injectable()
export class WorkspaceConnectorRoutingService {
  public constructor(private readonly prisma: PrismaService) {}

  public async settings(workspaceId: string): Promise<WorkspaceConnectorRoutingSettings> {
    const [bindings, credentials, enabledPlatformAccounts] = await this.prisma.$transaction([
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
      }),
      this.prisma.platformProviderAccount.findMany({
        where: { enabled: true },
        select: { provider: true }
      })
    ]);
    const enabledPlatformProviders = new Set(
      enabledPlatformAccounts.map(({ provider: value }) => value)
    );
    return {
      bindings: bindings.map(binding =>
        workspaceBindingSummary(binding, enabledPlatformProviders)
      ),
      credentialOptions: credentials
        .slice(0, MAX_CREDENTIAL_OPTIONS)
        .filter(credential =>
          credential.mode !== "PLATFORM_PAID" ||
          enabledPlatformProviders.has(credential.provider)
        )
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
      const enabledPlatformProviders = await enabledPlatformProviderSet(transaction);
      for (const route of input.routes) {
        const credential = credentials.get(route.credentialId);
        if (!credential || (
          input.enabled &&
          routeAvailability(
            input.capability,
            credential,
            undefined,
            enabledPlatformProviders
          ) !== "READY"
        )) {
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
      return workspaceBindingSummary(saved, enabledPlatformProviders);
    });
  }

  /** Resolves the workspace route and materialises its immutable project reference graph. */
  public async resolve(
    workspaceId: string,
    projectId: string,
    capability: IntegrationCapability,
    actorId: string,
    requestedProvider?: IntegrationProvider,
    requestedCredentialId?: string,
    requirement?: ConnectorRouteRequirement
  ): Promise<ResolvedConnectorRoute> {
    const project = await this.ensureEffectiveProjectBinding(
      workspaceId,
      projectId,
      capability,
      actorId
    );
    const enabledPlatformProviders = await enabledPlatformProviderSet(this.prisma);
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
      const availability = routeAvailability(
        capability,
        candidate.route.credential,
        requirement,
        enabledPlatformProviders
      );
      if (availability === "READY") {
        attempts.push(attempt(index + 1, candidate, "SELECTED"));
        const quota = safeCredentialQuota(
          provider(candidate.route.credential.provider),
          candidate.route.credential.providerMeta,
          candidate.route.credential.lastSuccessAt
        );
        return {
          bindingId: candidate.binding.id,
          bindingVersion: candidate.binding.version,
          routeId: candidate.route.id,
          credentialId: candidate.route.credentialId,
          provider: provider(candidate.route.credential.provider),
          credentialMode: candidate.route.credential.mode,
          routingScope: candidate.scope,
          position: candidate.route.position,
          attempts,
          ...(quota.status === "AVAILABLE" && quota.xmlStockPricing
            ? { xmlStockPricing: quota.xmlStockPricing }
            : {})
        };
      }
      const reason = fallbackReason(
        candidate.route.credential,
        requirement
      );
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

        if (!workspace?.enabled || workspace.routes.length === 0) {
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
  await replaceActiveProjectConnectorRoutes(
    transaction,
    { workspaceId, projectId, bindingId },
    workspaceRoutes.map((route, index) => ({
      position: retainedRoutes.length + index,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: route.credentialId,
      routingScope: scope,
      workspaceRouteId: route.id
    })),
    retainedIds
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

function workspaceBindingSummary(
  binding: WorkspaceBindingRecord,
  enabledPlatformProviders?: ReadonlySet<string>
): WorkspaceConnectorBinding {
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
      availability: routeAvailability(
        bindingCapability,
        route.credential,
        undefined,
        enabledPlatformProviders
      ),
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
  credential: CredentialRecord,
  requirement?: ConnectorRouteRequirement,
  enabledPlatformProviders?: ReadonlySet<string>
): ProjectConnectorBindingAvailability {
  if (credential.deletedAt) return "CREDENTIAL_UNAVAILABLE";
  if (credential.status === "PENDING_VERIFICATION") return "CREDENTIAL_PENDING";
  if (
    credential.status !== "ACTIVE" ||
    (credential.mode === "PLATFORM_PAID" &&
      enabledPlatformProviders !== undefined &&
      !enabledPlatformProviders.has(credential.provider)) ||
    !credentialModeSupportsCapability(credential.mode, capabilityValue, credential.provider)
  ) {
    return "CREDENTIAL_UNAVAILABLE";
  }
  if (!safeIntegrationCredentialCapabilities(
    provider(credential.provider),
    credential.capabilities
  ).includes(capabilityValue)) {
    return "CAPABILITY_MISMATCH";
  }
  return xmlStockBalanceInsufficient(credential, requirement)
    ? "CREDENTIAL_UNAVAILABLE"
    : "READY";
}

async function enabledPlatformProviderSet(
  prisma: Pick<PrismaService, "platformProviderAccount"> | Prisma.TransactionClient
): Promise<ReadonlySet<string>> {
  const rows = await prisma.platformProviderAccount.findMany({
    where: { enabled: true },
    select: { provider: true }
  });
  return new Set(rows.map(({ provider: value }) => value));
}

async function lockedCredentials(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  ids: readonly string[]
): Promise<Map<string, CredentialRecord>> {
  const rows = await transaction.integrationCredential.findMany({
    where: { workspaceId, id: { in: [...ids] } },
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

function fallbackReason(
  credential: CredentialRecord,
  requirement?: ConnectorRouteRequirement
): ConnectorFallbackReason {
  if (
    credential.status === "LOW_BALANCE" ||
    xmlStockBalanceInsufficient(credential, requirement)
  ) return "LOW_BALANCE";
  if (credential.status === "RATE_LIMITED") return "RATE_LIMITED";
  if (credential.status === "DEGRADED") return "RETRYABLE_PROVIDER_ERROR";
  return "CREDENTIAL_UNAVAILABLE";
}

function xmlStockBalanceInsufficient(
  credential: CredentialRecord,
  requirement?: ConnectorRouteRequirement
): boolean {
  if (
    credential.provider !== "XMLSTOCK" ||
    credential.mode !== "BYOK_API_KEY" ||
    requirement?.xmlStock === undefined
  ) return false;
  const requested = requirement.xmlStock;
  if (!requested || !Number.isSafeInteger(requested.requestCount) || requested.requestCount < 1) {
    return false;
  }
  const quota = safeCredentialQuota(
    "XMLSTOCK",
    credential.providerMeta,
    credential.lastSuccessAt
  );
  if (quota.status !== "AVAILABLE" || !quota.balance || !quota.xmlStockPricing) {
    return false;
  }
  const usage = xmlStockOperationUsage(
    quota.xmlStockPricing,
    requested.product,
    requested.requestCount,
    requested.requestCount
  );
  const balanceUnits = decimalRublesToProviderUnits(quota.balance.amount);
  return Boolean(
    usage &&
    balanceUnits !== undefined &&
    balanceUnits < BigInt(usage.estimatedCostMicro.maximum) * 100n
  );
}

function decimalRublesToProviderUnits(value: string): bigint | undefined {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/u.test(value)) return undefined;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
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
