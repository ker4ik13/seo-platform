import {
  createHash,
  timingSafeEqual
} from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import {
  currentRankProviderPolicyVersion,
  legacyRankProviderPolicyVersion,
  rankEstimateBlockerCodes,
  rankProviderKeywordLimit,
  rankProviderOverflowCount,
  xmlStockRankProviderPolicyVersion,
  type InternalCreateRankEstimateInput,
  type InternalRankExecutionParameters,
  type InternalRankEstimateScope,
  type IntegrationProvider,
  type RankEstimate,
  type RankEstimateBlockerCode,
  type RankEstimateCredentialFreshness,
  type RankEstimateScopeHash
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type {
  CredentialStatus,
  RankEstimate as StoredRankEstimate
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  ARSENKIN_CREDENTIAL_VALIDATION_CONNECTOR_VERSION,
  XMLSTOCK_CREDENTIAL_VALIDATION_CONNECTOR_VERSION
} from "../integrations/integration-credential-connector-versions.js";
import { safeIntegrationCredentialCapabilities } from "../integrations/integration-credential-capabilities.js";
import {
  WorkspaceConnectorRoutingService,
  type ResolvedConnectorRoute
} from "../integrations/workspace-connector-routing.service.js";
import {
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationDeduplicationKey,
  integrationCredentialValidationJobInput
} from "../integrations/integration-credential-validation-job.js";
import {
  SeoDataClient,
  SeoDataClientError
} from "../seo-data/seo-data.client.js";
import {
  rankEstimateExecutionHash,
  rankEstimateExecutionJson,
  rankEstimateExecutionParameters,
  storedRankEstimateExecution
} from "./rank-estimate-execution.js";
import {
  rankEstimateSnapshot,
  rankEstimateSnapshotJson
} from "./rank-estimate-snapshot.js";

export const RANK_ESTIMATE_POLICY_VERSION =
  currentRankProviderPolicyVersion;
export const RANK_ESTIMATE_TTL_MILLISECONDS = 5 * 60 * 1_000;
export const RANK_ESTIMATE_KEYWORD_LIMIT = rankProviderKeywordLimit;
export const RANK_ESTIMATE_VALIDATION_FRESHNESS_MILLISECONDS =
  24 * 60 * 60 * 1_000;

const IDEMPOTENCY_SCOPE_PREFIX = "rank-estimate:";
const REQUEST_HASH_DOMAIN = "seo-platform.rank-estimate.request.v1\u0000";
const PROJECT_DOMAIN_HASH_DOMAIN =
  "seo-platform.rank-estimate.project-domain.v1\u0000";
const SCOPE_HASH_DOMAIN = "seo-platform.rank-estimate.execution-scope.v1\u0000";

const BINDING_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  capability: true,
  enabled: true,
  version: true,
  routes: {
    where: { retiredAt: null },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    take: 8,
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      bindingId: true,
      position: true,
      sourceKind: true,
      credentialId: true,
      credential: {
        select: {
          id: true,
          workspaceId: true,
          provider: true,
          mode: true,
          status: true,
          capabilities: true,
          materialVersion: true,
          version: true,
          verifiedAt: true,
          lastSuccessAt: true,
          deletedAt: true
        }
      }
    }
  }
} as const satisfies Prisma.ProjectConnectorBindingSelect;

const VALIDATION_SELECT = {
  id: true,
  workspaceId: true,
  provider: true,
  status: true,
  inputSnapshot: true,
  deduplicationKey: true,
  version: true,
  finishedAt: true
} as const satisfies Prisma.JobSelect;

export type BindingProjection = Prisma.ProjectConnectorBindingGetPayload<{
  select: typeof BINDING_SELECT;
}>;
export type ValidationProjection = Prisma.JobGetPayload<{
  select: typeof VALIDATION_SELECT;
}>;
export type EstimateTransaction = Prisma.TransactionClient;

export interface ExecutionProjection {
  readonly binding?: BindingProjection;
  readonly route?: BindingProjection["routes"][number];
  readonly validation?: ValidationProjection;
}

export interface CredentialSnapshot {
  readonly provider?: "ARSENKIN" | "XMLSTOCK";
  readonly bindingId?: string;
  readonly bindingVersion?: number;
  readonly routeId?: string;
  readonly credentialId?: string;
  readonly credentialStatus?: CredentialStatus;
  readonly credentialVersion?: number;
  readonly credentialMaterialVersion?: number;
  readonly credentialDeletedAt?: Date;
  readonly validationId?: string;
  readonly validationVersion?: number;
  readonly validationConnectorVersion?: string;
  readonly validationFinishedAt?: Date;
  readonly verifiedAt?: Date;
}

@Injectable()
export class RankEstimateService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly seoData: SeoDataClient,
    private readonly routing: WorkspaceConnectorRoutingService
  ) {}

  public async create(
    input: InternalCreateRankEstimateInput,
    idempotencyKey: string
  ): Promise<RankEstimate> {
    const idempotencyScope = rankEstimateIdempotencyScope(input.projectId);
    const requestHash = rankEstimateRequestHash(input);
    const replay = await this.findIdempotent(
      input,
      idempotencyScope,
      idempotencyKey,
      requestHash
    );
    if (replay) return replay;

    let resolvedRoute: ResolvedConnectorRoute | undefined;
    try {
      resolvedRoute = await this.routing.resolve(
        input.workspaceId,
        input.projectId,
        "SERP_RANK_TRACKING",
        input.actorId,
        input.provider,
        input.credentialId
      );
    } catch (error) {
      // An estimate must still explain a missing/unavailable connector. Only
      // the known routing-state conflict is converted into a blocked estimate;
      // storage, validation and transport failures remain fail-closed.
      if (!isConnectorNotReady(error)) throw error;
    }

    const scope = await this.resolveScope(input);
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const transactionReplay = await findStoredEstimate(
            transaction,
            input.workspaceId,
            idempotencyScope,
            idempotencyKey
          );
          if (transactionReplay) {
            return checkedReplay(
              transactionReplay,
              input,
              requestHash
            );
          }

          const projection = await executionProjection(
            transaction,
            input.workspaceId,
            input.projectId,
            resolvedRoute?.provider === "ARSENKIN" ||
              resolvedRoute?.provider === "XMLSTOCK"
              ? resolvedRoute.provider
              : input.provider,
            resolvedRoute?.routeId
          );
          const [databaseClock] = await transaction.$queryRaw<
            readonly {
              readonly id: string;
              readonly calculatedAt: Date;
            }[]
          >`
            SELECT
              uuidv7()::text AS "id",
              clock_timestamp() AS "calculatedAt"
          `;
          if (
            !databaseClock ||
            !UUID_PATTERN.test(databaseClock.id) ||
            !(databaseClock.calculatedAt instanceof Date) ||
            Number.isNaN(databaseClock.calculatedAt.getTime())
          ) {
            throw new Error("Unable to allocate rank estimate snapshot");
          }
          const calculatedAt = databaseClock.calculatedAt;
          const expiresAt = new Date(
            calculatedAt.getTime() + RANK_ESTIMATE_TTL_MILLISECONDS
          );
          const privateSnapshot = credentialSnapshot(projection);
          const provider = rankProvider(projection, input.provider);
          const providerPolicyVersion = rankProviderPolicyVersion(provider);
          const projectDomainHash = rankEstimateProjectDomainHash(
            input.project.domain
          );
          const scopeHash = executionScopeHash(
            input,
            scope,
            projectDomainHash,
            privateSnapshot,
            provider,
            providerPolicyVersion
          );
          const execution = rankEstimateExecutionParameters(
            scope.configuration,
            provider,
            input.searchSource
          );
          const blockers = estimateBlockers(
            input,
            scope,
            projection,
            privateSnapshot,
            calculatedAt,
            provider
          );
          const freshness = credentialFreshness(
            projection,
            privateSnapshot,
            calculatedAt
          );
          const keywordCount = Number(scope.keywordCount);
          const providerTaskCount =
            keywordCount > RANK_ESTIMATE_KEYWORD_LIMIT
              ? 0
              : keywordCount === 0
                ? 0
                : provider === "XMLSTOCK"
                  ? keywordCount
                  : 1;
          const estimate = publicEstimate({
            id: databaseClock.id,
            input,
            scope,
            scopeHash,
            blockers,
            freshness,
            providerTaskCount,
            provider,
            ...(resolvedRoute ? { resolvedRoute } : {}),
            providerPolicyVersion,
            ...(execution ? { execution } : {}),
            calculatedAt,
            expiresAt
          });
          await transaction.rankEstimate.create({
            data: {
              id: databaseClock.id,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              actorId: input.actorId,
              trackingContextId: input.trackingContextId,
              idempotencyScope,
              idempotencyKey,
              requestHash: databaseBytes(requestHash),
              projectVersion: input.project.version,
              projectDomainHash: databaseBytes(projectDomainHash),
              contextVersion: scope.contextVersion,
              configurationVersion: scope.configurationVersion,
              configurationHash: databaseBytes(
                Buffer.from(scope.configurationHash, "hex")
              ),
              semanticScopeHash:
                scope.semanticScopeHash.availability === "AVAILABLE"
                  ? databaseBytes(
                      Buffer.from(scope.semanticScopeHash.value, "hex")
                    )
                  : null,
              scopeHash:
                scopeHash.availability === "AVAILABLE"
                  ? databaseBytes(Buffer.from(scopeHash.value, "hex"))
                  : null,
              bindingId: privateSnapshot.bindingId ?? null,
              bindingVersion: privateSnapshot.bindingVersion ?? null,
              routeId: privateSnapshot.routeId ?? null,
              credentialId: privateSnapshot.credentialId ?? null,
              credentialStatus:
                privateSnapshot.credentialStatus ?? null,
              credentialVersion: privateSnapshot.credentialVersion ?? null,
              credentialMaterialVersion:
                privateSnapshot.credentialMaterialVersion ?? null,
              credentialDeletedAt:
                privateSnapshot.credentialDeletedAt ?? null,
              credentialValidationId:
                privateSnapshot.validationId ?? null,
              credentialValidationVersion:
                privateSnapshot.validationVersion ?? null,
              credentialValidationConnectorVersion:
                privateSnapshot.validationConnectorVersion ?? null,
              credentialValidationFinishedAt:
                privateSnapshot.validationFinishedAt ?? null,
              credentialVerifiedAt: privateSnapshot.verifiedAt ?? null,
              provider,
              credentialMode: "BYOK_API_KEY",
              providerPolicyVersion,
              keywordCount,
              providerTaskCount,
              minimumSubmitRequestCount:
                providerMinimumRequests(provider, execution, providerTaskCount)
                  .submit,
              minimumCheckRequestCount:
                providerMinimumRequests(provider, execution, providerTaskCount)
                  .check,
              minimumGetRequestCount:
                providerMinimumRequests(provider, execution, providerTaskCount)
                  .get,
              blockers: blockersJson(blockers),
              responseSnapshot: rankEstimateSnapshotJson(estimate),
              executionSnapshot: execution
                ? rankEstimateExecutionJson(execution)
                : Prisma.DbNull,
              executionSnapshotHash: execution
                ? databaseBytes(rankEstimateExecutionHash(execution))
                : null,
              calculatedAt,
              expiresAt
            }
          });
          return estimate;
        },
        { isolationLevel: "RepeatableRead" }
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.findIdempotent(
        input,
        idempotencyScope,
        idempotencyKey,
        requestHash
      );
      if (winner) return winner;
      throw error;
    }
  }

  private async findIdempotent(
    input: InternalCreateRankEstimateInput,
    idempotencyScope: string,
    idempotencyKey: string,
    requestHash: Buffer
  ): Promise<RankEstimate | null> {
    const estimate = await this.prisma.rankEstimate.findUnique({
      where: {
        workspaceId_idempotencyScope_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyScope,
          idempotencyKey
        }
      }
    });
    return estimate ? checkedReplay(estimate, input, requestHash) : null;
  }

  private async resolveScope(
    input: InternalCreateRankEstimateInput
  ): Promise<InternalRankEstimateScope> {
    try {
      return await this.seoData.rankEstimateScope({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        trackingContextId: input.trackingContextId
      });
    } catch (error) {
      if (!(error instanceof SeoDataClientError)) throw error;
      if (error.code === "NOT_FOUND") {
        throw new NotFoundException("Tracking context not found");
      }
      if (error.code === "INVALID_COMMAND") {
        throw new BadRequestException("Invalid rank estimate scope");
      }
      if (error.code === "CONFLICT") {
        throw new ConflictException("Rank estimate scope is unavailable");
      }
      throw new ServiceUnavailableException(
        "SEO data scope is temporarily unavailable",
        { cause: error }
      );
    }
  }
}

export function rankEstimateIdempotencyScope(projectId: string): string {
  return `${IDEMPOTENCY_SCOPE_PREFIX}${projectId}`;
}

export function rankEstimateRequestHash(
  input: InternalCreateRankEstimateInput
): Buffer {
  return hash(
    REQUEST_HASH_DOMAIN,
    canonicalJson({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      trackingContextId: input.trackingContextId,
      provider: input.provider ?? null,
      credentialId: input.credentialId ?? null,
      searchSource: input.searchSource ?? null
    })
  );
}

export function rankEstimateProjectDomainHash(domain: string): Buffer {
  return hash(PROJECT_DOMAIN_HASH_DOMAIN, domain);
}

function isConnectorNotReady(error: unknown): boolean {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return typeof response === "object" &&
    response !== null &&
    !Array.isArray(response) &&
    (response as Readonly<Record<string, unknown>>).code ===
      "CONNECTOR_NOT_READY";
}

export async function executionProjection(
  transaction: EstimateTransaction,
  workspaceId: string,
  projectId: string,
  requestedProvider?: "ARSENKIN" | "XMLSTOCK",
  requestedRouteId?: string
): Promise<ExecutionProjection> {
  const binding = await transaction.projectConnectorBinding.findFirst({
    where: {
      workspaceId,
      projectId,
      capability: "SERP_RANK_TRACKING"
    },
    select: BINDING_SELECT
  });
  if (!binding) {
    return binding ? { binding } : {};
  }
  const matchingRoutes = requestedRouteId
    ? binding.routes.filter(({ id }) => id === requestedRouteId)
    : requestedProvider
    ? binding.routes.filter(
        ({ credential }) => credential.provider === requestedProvider
      )
    : binding.routes.filter(({ position }) => position === 0);
  const primaryRoute = requestedRouteId
    ? matchingRoutes[0]
    : matchingRoutes.find(({ position }) => position === 0);
  const route = primaryRoute ?? (
    matchingRoutes.length === 1 ? matchingRoutes[0] : undefined
  );
  if (!route) return { binding };

  const validation = await transaction.job.findFirst({
    where: {
      workspaceId,
      type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
      status: "COMPLETED",
      provider: route.credential.provider,
      deduplicationKey:
        integrationCredentialValidationDeduplicationKey(
          route.credentialId,
          route.credential.materialVersion
        )
    },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    select: VALIDATION_SELECT
  });
  return {
    binding,
    route,
    ...(validation ? { validation } : {})
  };
}

export function credentialSnapshot(
  projection: ExecutionProjection
): CredentialSnapshot {
  const binding = projection.binding;
  const route = projection.route;
  if (!binding || !route) {
    return binding
      ? { bindingId: binding.id, bindingVersion: binding.version }
      : {};
  }
  const base: CredentialSnapshot = {
    ...(route.credential.provider === "ARSENKIN" ||
    route.credential.provider === "XMLSTOCK"
      ? { provider: route.credential.provider }
      : {}),
    bindingId: binding.id,
    bindingVersion: binding.version,
    routeId: route.id,
    credentialId: route.credential.id,
    credentialStatus: route.credential.status,
    credentialVersion: route.credential.version,
    credentialMaterialVersion: route.credential.materialVersion,
    ...(route.credential.deletedAt
      ? { credentialDeletedAt: route.credential.deletedAt }
      : {}),
    ...(route.credential.verifiedAt
      ? { verifiedAt: route.credential.verifiedAt }
      : {})
  };
  const proof = currentValidationProof(
    projection.validation,
    route.credential.workspaceId,
    route.credential.id,
    route.credential.provider,
    route.credential.materialVersion,
    route.credential.verifiedAt,
    route.credential.lastSuccessAt
  );
  return proof ? { ...base, ...proof } : base;
}

function currentValidationProof(
  validation: ValidationProjection | undefined,
  workspaceId: string,
  credentialId: string,
  provider: string,
  materialVersion: number,
  verifiedAt: Date | null,
  lastSuccessAt: Date | null
): Pick<
  CredentialSnapshot,
  | "validationId"
  | "validationVersion"
  | "validationConnectorVersion"
  | "validationFinishedAt"
> | undefined {
  if (
    !validation ||
    validation.workspaceId !== workspaceId ||
    validation.provider !== provider ||
    validation.status !== "COMPLETED" ||
    !validation.finishedAt ||
    !verifiedAt ||
    !lastSuccessAt ||
    validation.finishedAt.getTime() !== verifiedAt.getTime() ||
    validation.finishedAt.getTime() !== lastSuccessAt.getTime() ||
    validation.deduplicationKey !==
      integrationCredentialValidationDeduplicationKey(
        credentialId,
        materialVersion
      )
  ) {
    return undefined;
  }
  try {
    const input = integrationCredentialValidationJobInput(
      validation.inputSnapshot
    );
    if (
      input.credentialId !== credentialId ||
      input.credentialMaterialVersion !== materialVersion ||
      input.connectorVersion !== validationConnectorVersion(provider)
    ) {
      return undefined;
    }
    return {
      validationId: validation.id,
      validationVersion: validation.version,
      validationConnectorVersion: input.connectorVersion,
      validationFinishedAt: validation.finishedAt
    };
  } catch {
    return undefined;
  }
}

function credentialFreshness(
  projection: ExecutionProjection,
  snapshot: CredentialSnapshot,
  calculatedAt: Date
): RankEstimateCredentialFreshness {
  const route = projection.route;
  if (!route) return { status: "NOT_AVAILABLE" };
  if (
    !route.credential.deletedAt &&
    route.credential.status === "ACTIVE" &&
    snapshot.validationId &&
    snapshot.validationFinishedAt &&
    snapshot.verifiedAt &&
    isFreshTimestamp(snapshot.validationFinishedAt, calculatedAt)
  ) {
    return {
      status: "FRESH",
      verifiedAt: snapshot.verifiedAt.toISOString()
    };
  }
  if (snapshot.verifiedAt || projection.validation) {
    return {
      status: "STALE",
      ...(snapshot.verifiedAt
        ? { verifiedAt: snapshot.verifiedAt.toISOString() }
        : {})
    };
  }
  return { status: "UNVERIFIED" };
}

function isFreshTimestamp(value: Date, calculatedAt: Date): boolean {
  const age = calculatedAt.getTime() - value.getTime();
  return (
    age >= 0 &&
    age <= RANK_ESTIMATE_VALIDATION_FRESHNESS_MILLISECONDS
  );
}

function executionScopeHash(
  input: InternalCreateRankEstimateInput,
  scope: InternalRankEstimateScope,
  projectDomainHash: Buffer,
  snapshot: CredentialSnapshot,
  provider: "ARSENKIN" | "XMLSTOCK",
  providerPolicyVersion: string
): RankEstimateScopeHash {
  if (scope.semanticScopeHash.availability === "UNAVAILABLE") {
    return { availability: "UNAVAILABLE" };
  }
  return availableScopeHash({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      trackingContextId: input.trackingContextId,
      projectVersion: input.project.version,
      projectDomainHash: projectDomainHash.toString("hex"),
      semanticScopeHash: scope.semanticScopeHash.value,
      contextVersion: scope.contextVersion,
      configurationVersion: scope.configurationVersion,
      configurationHash: scope.configurationHash,
      bindingId: snapshot.bindingId ?? null,
      bindingVersion: snapshot.bindingVersion ?? null,
      routeId: snapshot.routeId ?? null,
      credentialId: snapshot.credentialId ?? null,
      credentialStatus: snapshot.credentialStatus ?? null,
      credentialVersion: snapshot.credentialVersion ?? null,
      credentialMaterialVersion:
        snapshot.credentialMaterialVersion ?? null,
      credentialDeletedAt:
        snapshot.credentialDeletedAt?.toISOString() ?? null,
      validationId: snapshot.validationId ?? null,
      validationVersion: snapshot.validationVersion ?? null,
      validationConnectorVersion:
        snapshot.validationConnectorVersion ?? null,
      validationFinishedAt:
        snapshot.validationFinishedAt?.toISOString() ?? null,
      credentialVerifiedAt: snapshot.verifiedAt?.toISOString() ?? null,
      provider,
      credentialMode: "BYOK_API_KEY",
      providerPolicyVersion
  });
}

function estimateBlockers(
  input: InternalCreateRankEstimateInput,
  scope: InternalRankEstimateScope,
  projection: ExecutionProjection,
  snapshot: CredentialSnapshot,
  calculatedAt: Date,
  provider: "ARSENKIN" | "XMLSTOCK"
): RankEstimateBlockerCode[] {
  const blockers = new Set<RankEstimateBlockerCode>();
  const keywordCount = Number(scope.keywordCount);
  const execution = rankEstimateExecutionParameters(
    scope.configuration,
    provider,
    input.searchSource
  );
  if (scope.contextStatus === "ARCHIVED") blockers.add("CONTEXT_ARCHIVED");
  if (keywordCount === 0) blockers.add("NO_ASSIGNED_KEYWORDS");
  if (keywordCount > RANK_ESTIMATE_KEYWORD_LIMIT) {
    blockers.add("KEYWORD_LIMIT_EXCEEDED");
  }
  if (scope.semanticScopeHash.availability === "UNAVAILABLE") {
    blockers.add("SCOPE_HASH_UNAVAILABLE");
  }
  if (!execution) {
    if (
      !["GOOGLE", "YANDEX"].includes(scope.configuration.searchEngine)
    ) {
      blockers.add("UNSUPPORTED_SEARCH_ENGINE");
    }
    if (
      ![30, 50, 100].includes(scope.configuration.depth) ||
      (provider === "ARSENKIN" &&
        scope.configuration.searchEngine === "YANDEX" &&
        scope.configuration.depth !== 30)
    ) {
      blockers.add("UNSUPPORTED_DEPTH");
    }
    if (
      !scope.configuration.regionCode ||
      !/^\d{1,10}$/u.test(scope.configuration.regionCode)
    ) {
      blockers.add("REGION_MAPPING_UNVERIFIED");
    }
    if (scope.configuration.safeSearch) {
      blockers.add("SAFE_SEARCH_MAPPING_UNVERIFIED");
    }
    if (
      ["CANONICAL_DOMAIN", "ANY_PROJECT_MIRROR"].includes(
        scope.configuration.domainMatchRule.mode
      )
    ) {
      blockers.add("DOMAIN_MAPPING_UNVERIFIED");
    }
  }

  const binding = projection.binding;
  const route = projection.route;
  if (!binding) {
    blockers.add("BINDING_NOT_CONFIGURED");
  } else {
    if (!binding.enabled) blockers.add("BINDING_DISABLED");
    if (!route) {
      blockers.add("BINDING_ROUTE_UNSUPPORTED");
    } else {
      if (
        !Number.isSafeInteger(route.position) ||
        route.position < 0 ||
        route.sourceKind !== "WORKSPACE_CREDENTIAL" ||
        route.workspaceId !== input.workspaceId ||
        route.projectId !== input.projectId ||
        route.bindingId !== binding.id ||
        route.credential.workspaceId !== input.workspaceId ||
        route.credentialId !== route.credential.id
      ) {
        blockers.add("BINDING_ROUTE_UNSUPPORTED");
      }
      if (route.credential.provider !== provider) {
        blockers.add("CREDENTIAL_PROVIDER_MISMATCH");
      }
      if (route.credential.mode !== "BYOK_API_KEY") {
        blockers.add("CREDENTIAL_MODE_UNSUPPORTED");
      }
      if (
        route.credential.deletedAt ||
        route.credential.status !== "ACTIVE"
      ) {
        blockers.add("CREDENTIAL_NOT_ACTIVE");
      }
      const providerDefinition = integrationProvider(
        route.credential.provider
      );
      const capabilities = providerDefinition
        ? safeIntegrationCredentialCapabilities(
            providerDefinition,
            route.credential.capabilities
          )
        : [];
      if (!capabilities.includes("SERP_RANK_TRACKING")) {
        blockers.add("BINDING_NOT_READY");
      }
      if (
        credentialFreshness(
          projection,
          snapshot,
          calculatedAt
        ).status !== "FRESH"
      ) {
        blockers.add("CREDENTIAL_NOT_FRESH");
      }
    }
  }

  if (input.access.entitlementStatus === "NOT_AVAILABLE") {
    blockers.add("ENTITLEMENT_NOT_AVAILABLE");
  } else if (input.access.entitlementStatus === "DENIED") {
    blockers.add("ENTITLEMENT_DENIED");
  }
  if (input.quota.status === "EXHAUSTED") {
    blockers.add("QUOTA_EXCEEDED");
  }
  if (!input.access.canRunRanking) blockers.add("MISSING_RUN_PERMISSION");
  if (input.access.workspaceStatus === "READ_ONLY") {
    blockers.add("WORKSPACE_READ_ONLY");
  } else if (input.access.workspaceStatus === "SUSPENDED") {
    blockers.add("WORKSPACE_SUSPENDED");
  }
  if (input.project.status === "ARCHIVED") {
    blockers.add("PROJECT_ARCHIVED");
  } else if (input.project.status !== "ACTIVE") {
    blockers.add("PROJECT_NOT_ACTIVE");
  }
  return rankEstimateBlockerCodes.filter((code) => blockers.has(code));
}

function publicEstimate(input: {
  readonly id: string;
  readonly input: InternalCreateRankEstimateInput;
  readonly scope: InternalRankEstimateScope;
  readonly scopeHash: RankEstimateScopeHash;
  readonly blockers: readonly RankEstimateBlockerCode[];
  readonly freshness: RankEstimateCredentialFreshness;
  readonly providerTaskCount: number;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly resolvedRoute?: ResolvedConnectorRoute;
  readonly providerPolicyVersion: string;
  readonly execution?: InternalRankExecutionParameters;
  readonly calculatedAt: Date;
  readonly expiresAt: Date;
}): RankEstimate {
  const executionAllowed = input.blockers.length === 0;
  return {
    id: input.id,
    workspaceId: input.input.workspaceId,
    projectId: input.input.projectId,
    trackingContextId: input.input.trackingContextId,
    status: executionAllowed ? "READY" : "BLOCKED",
    provider: input.provider,
    ...(input.resolvedRoute
      ? {
          routingScope: input.resolvedRoute.routingScope,
          connectorAttempts: input.resolvedRoute.attempts
        }
      : {}),
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    scope: {
      keywordCount: input.scope.keywordCount,
      contextCount: "1",
      pairCount: input.scope.pairCount,
      scopeHash: input.scopeHash,
      contextVersion: input.scope.contextVersion,
      configurationVersion: input.scope.configurationVersion
    },
    workload: {
      taskCount: String(input.providerTaskCount),
      minimumRequestCount: String(
        providerMinimumRequestCount(
          input.provider,
          input.execution,
          input.providerTaskCount
        )
      ),
      pollingRequestCount: { status: "NOT_AVAILABLE" },
      requestStages:
        input.provider === "ARSENKIN"
          ? ["SET", "CHECK", "GET"]
          : input.execution?.searchEngine === "YANDEX" &&
              !input.execution.providerMappingVersion.includes("-live@")
            ? ["SUBMIT", "POLL"]
            : ["GET"],
      keywordLimitPerTask: input.provider === "XMLSTOCK" ? "1" : "15000",
      keywordLimitPerCommand: "15000",
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE"
    },
    providerLimits: { status: "NOT_AVAILABLE" },
    expectedDuration: { status: "NOT_AVAILABLE" },
    platformChargeMicro: "0",
    billingCurrency: input.input.billingCurrency,
    quota: input.input.quota,
    credentialFreshness: input.freshness,
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    },
    blockers: input.blockers.map((code) => ({ code })),
    executionAllowed,
    policyVersion: input.providerPolicyVersion,
    calculatedAt: input.calculatedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString()
  };
}

function checkedReplay(
  stored: StoredRankEstimate,
  input: InternalCreateRankEstimateInput,
  requestHash: Buffer
): RankEstimate {
  if (!requestHashMatches(stored.requestHash, requestHash)) {
    throw idempotencyConflict();
  }
  const { summary: snapshot } = verifiedRankEstimate(stored);
  if (
    snapshot.workspaceId !== input.workspaceId ||
    snapshot.projectId !== input.projectId ||
    snapshot.trackingContextId !== input.trackingContextId ||
    stored.actorId !== input.actorId
  ) {
    throw new Error("Invalid immutable rank estimate snapshot");
  }
  return snapshot;
}

export interface VerifiedRankEstimate {
  readonly summary: RankEstimate;
  readonly execution?: InternalRankExecutionParameters;
}

export function verifiedRankEstimate(
  stored: StoredRankEstimate
): VerifiedRankEstimate {
  const snapshot = rankEstimateSnapshot(stored.responseSnapshot);
  const execution = storedRankEstimateExecution(
    stored.executionSnapshot,
    stored.executionSnapshotHash
  );
  const storedHash = storedExecutionScopeHash(stored);
  if (
    snapshot.id !== stored.id ||
    snapshot.workspaceId !== stored.workspaceId ||
    snapshot.projectId !== stored.projectId ||
    snapshot.trackingContextId !== stored.trackingContextId ||
    (stored.provider !== "ARSENKIN" && stored.provider !== "XMLSTOCK") ||
    snapshot.provider !== stored.provider ||
    stored.credentialMode !== "BYOK_API_KEY" ||
    stored.contextVersion !== snapshot.scope.contextVersion ||
    stored.configurationVersion !==
      snapshot.scope.configurationVersion ||
    stored.keywordCount !== Number(snapshot.scope.keywordCount) ||
    stored.providerTaskCount !== Number(snapshot.workload.taskCount) ||
    stored.minimumSubmitRequestCount !==
      providerMinimumRequests(stored.provider, execution, stored.providerTaskCount)
        .submit ||
    stored.minimumCheckRequestCount !==
      providerMinimumRequests(stored.provider, execution, stored.providerTaskCount)
        .check ||
    stored.minimumGetRequestCount !==
      providerMinimumRequests(stored.provider, execution, stored.providerTaskCount)
        .get ||
    !scopeHashesEqual(snapshot.scope.scopeHash, storedHash) ||
    !jsonEqual(stored.blockers, snapshot.blockers) ||
    !credentialFreshnessMatches(stored, snapshot) ||
    snapshot.calculatedAt !== stored.calculatedAt.toISOString() ||
    snapshot.expiresAt !== stored.expiresAt.toISOString() ||
    snapshot.policyVersion !== stored.providerPolicyVersion ||
    (snapshot.status === "READY" && execution === undefined)
  ) {
    throw new Error("Invalid immutable rank estimate snapshot");
  }
  return {
    summary: snapshot,
    ...(execution ? { execution } : {})
  };
}

function storedExecutionScopeHash(
  stored: StoredRankEstimate
): RankEstimateScopeHash {
  const policyBounds =
    stored.providerPolicyVersion === legacyRankProviderPolicyVersion
      ? { keywordLimit: 1_000, overflowCount: 1_001 }
      : stored.providerPolicyVersion === currentRankProviderPolicyVersion
        ? {
            keywordLimit: RANK_ESTIMATE_KEYWORD_LIMIT,
            overflowCount: rankProviderOverflowCount
          }
        : stored.providerPolicyVersion === xmlStockRankProviderPolicyVersion
          ? {
              keywordLimit: RANK_ESTIMATE_KEYWORD_LIMIT,
              overflowCount: rankProviderOverflowCount
            }
          : undefined;
  if (
    policyBounds === undefined ||
    !Number.isInteger(stored.keywordCount) ||
    stored.keywordCount < 0 ||
    stored.keywordCount > policyBounds.overflowCount
  ) {
    throw new Error("Invalid immutable rank estimate keyword count");
  }
  if (stored.semanticScopeHash === null || stored.scopeHash === null) {
    if (
      stored.semanticScopeHash !== null ||
      stored.scopeHash !== null ||
      stored.keywordCount === 0
    ) {
      throw new Error("Invalid immutable rank estimate scope hashes");
    }
    return { availability: "UNAVAILABLE" };
  }
  if (stored.keywordCount > policyBounds.keywordLimit) {
    throw new Error("Invalid immutable rank estimate scope hashes");
  }
  const projectDomainHash = bytes32(stored.projectDomainHash);
  const semanticScopeHash = bytes32(stored.semanticScopeHash);
  const configurationHash = bytes32(stored.configurationHash);
  const persistedScopeHash = bytes32(stored.scopeHash);
  const recomputed = availableScopeHash({
    workspaceId: stored.workspaceId,
    projectId: stored.projectId,
    trackingContextId: stored.trackingContextId,
    projectVersion: stored.projectVersion,
    projectDomainHash,
    semanticScopeHash,
    contextVersion: stored.contextVersion,
    configurationVersion: stored.configurationVersion,
    configurationHash,
    bindingId: stored.bindingId,
    bindingVersion: stored.bindingVersion,
    routeId: stored.routeId,
    credentialId: stored.credentialId,
    credentialStatus: stored.credentialStatus,
    credentialVersion: stored.credentialVersion,
    credentialMaterialVersion: stored.credentialMaterialVersion,
    credentialDeletedAt:
      stored.credentialDeletedAt?.toISOString() ?? null,
    validationId: stored.credentialValidationId,
    validationVersion: stored.credentialValidationVersion,
    validationConnectorVersion:
      stored.credentialValidationConnectorVersion,
    validationFinishedAt:
      stored.credentialValidationFinishedAt?.toISOString() ?? null,
    credentialVerifiedAt:
      stored.credentialVerifiedAt?.toISOString() ?? null,
    provider: stored.provider,
    credentialMode: stored.credentialMode,
    providerPolicyVersion: stored.providerPolicyVersion
  });
  if (recomputed.value !== persistedScopeHash) {
    throw new Error("Invalid immutable rank estimate scope hash");
  }
  return recomputed;
}

function availableScopeHash(
  snapshot: Readonly<Record<string, unknown>>
): Extract<RankEstimateScopeHash, { readonly availability: "AVAILABLE" }> {
  return {
    availability: "AVAILABLE",
    algorithm: "SHA_256",
    value: hash(
      SCOPE_HASH_DOMAIN,
      canonicalJson(snapshot)
    ).toString("hex")
  };
}

function scopeHashesEqual(
  left: RankEstimateScopeHash,
  right: RankEstimateScopeHash
): boolean {
  return (
    left.availability === right.availability &&
    (left.availability === "UNAVAILABLE" ||
      (right.availability === "AVAILABLE" &&
        left.value === right.value))
  );
}

function credentialFreshnessMatches(
  stored: StoredRankEstimate,
  snapshot: RankEstimate
): boolean {
  const publicVerifiedAt =
    "verifiedAt" in snapshot.credentialFreshness
      ? snapshot.credentialFreshness.verifiedAt
      : undefined;
  if (
    publicVerifiedAt !== stored.credentialVerifiedAt?.toISOString()
  ) {
    return false;
  }
  if (snapshot.credentialFreshness.status === "NOT_AVAILABLE") {
    return stored.credentialId === null;
  }
  if (snapshot.credentialFreshness.status === "UNVERIFIED") {
    return (
      stored.credentialId !== null &&
      stored.credentialVerifiedAt === null &&
      stored.credentialValidationId === null
    );
  }
  const completeProof =
    stored.credentialId !== null &&
    stored.credentialVerifiedAt !== null &&
    stored.credentialValidationId !== null &&
    stored.credentialValidationVersion !== null &&
    stored.credentialValidationConnectorVersion !== null &&
    stored.credentialValidationFinishedAt !== null &&
    stored.credentialValidationFinishedAt.getTime() ===
      stored.credentialVerifiedAt.getTime();
  const credentialActive =
    stored.credentialStatus === "ACTIVE" &&
    stored.credentialDeletedAt === null;
  if (snapshot.credentialFreshness.status === "FRESH") {
    return (
      credentialActive &&
      completeProof &&
      isFreshTimestamp(
        stored.credentialValidationFinishedAt as Date,
        stored.calculatedAt
      )
    );
  }
  return stored.credentialId !== null && !(
    credentialActive &&
    completeProof &&
    isFreshTimestamp(
      stored.credentialValidationFinishedAt as Date,
      stored.calculatedAt
    )
  );
}

function jsonEqual(
  left: Prisma.JsonValue,
  right: unknown
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function bytes32(value: Uint8Array): string {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw new Error("Invalid immutable rank estimate hash length");
  }
  return bytes.toString("hex");
}

function findStoredEstimate(
  transaction: EstimateTransaction,
  workspaceId: string,
  idempotencyScope: string,
  idempotencyKey: string
): Promise<StoredRankEstimate | null> {
  return transaction.rankEstimate.findUnique({
    where: {
      workspaceId_idempotencyScope_idempotencyKey: {
        workspaceId,
        idempotencyScope,
        idempotencyKey
      }
    }
  });
}

function requestHashMatches(
  stored: Uint8Array,
  requestHash: Buffer
): boolean {
  const candidate = Buffer.from(stored);
  return (
    candidate.length === requestHash.length &&
    timingSafeEqual(candidate, requestHash)
  );
}

function hash(domain: string, value: string): Buffer {
  return createHash("sha256").update(domain, "utf8").update(value, "utf8").digest();
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

function blockersJson(
  blockers: readonly RankEstimateBlockerCode[]
): Prisma.InputJsonValue {
  return blockers.map((code) => ({ code }));
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function rankProvider(
  projection: ExecutionProjection,
  requestedProvider?: "ARSENKIN" | "XMLSTOCK"
): "ARSENKIN" | "XMLSTOCK" {
  if (requestedProvider) return requestedProvider;
  const candidate = projection.route?.credential.provider;
  return candidate === "XMLSTOCK" ? "XMLSTOCK" : "ARSENKIN";
}

export function rankProviderPolicyVersion(
  provider: "ARSENKIN" | "XMLSTOCK"
): string {
  return provider === "XMLSTOCK"
    ? xmlStockRankProviderPolicyVersion
    : RANK_ESTIMATE_POLICY_VERSION;
}

function validationConnectorVersion(provider: string): string | undefined {
  if (provider === "ARSENKIN") {
    return ARSENKIN_CREDENTIAL_VALIDATION_CONNECTOR_VERSION;
  }
  if (provider === "XMLSTOCK") {
    return XMLSTOCK_CREDENTIAL_VALIDATION_CONNECTOR_VERSION;
  }
  return undefined;
}

function providerMinimumRequests(
  provider: "ARSENKIN" | "XMLSTOCK",
  execution: InternalRankExecutionParameters | undefined,
  taskCount: number
): { readonly submit: number; readonly check: number; readonly get: number } {
  if (provider === "ARSENKIN") {
    return { submit: taskCount, check: taskCount, get: taskCount };
  }
  if (
    execution?.searchEngine === "YANDEX" &&
    !execution.providerMappingVersion.includes("-live@")
  ) {
    return { submit: taskCount, check: taskCount, get: 0 };
  }
  return {
    submit: 0,
    check: 0,
    get: taskCount * Math.ceil((execution?.depth ?? 100) / 10)
  };
}

function providerMinimumRequestCount(
  provider: "ARSENKIN" | "XMLSTOCK",
  execution: InternalRankExecutionParameters | undefined,
  taskCount: number
): number {
  const requests = providerMinimumRequests(provider, execution, taskCount);
  return requests.submit + requests.check + requests.get;
}

function integrationProvider(value: string): IntegrationProvider | undefined {
  return ["XMLSTOCK", "ARSENKIN", "KEYS_SO"].includes(value)
    ? (value as IntegrationProvider)
    : undefined;
}

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: "IDEMPOTENCY_CONFLICT",
    message:
      "Idempotency key was already used for another rank estimate request"
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
