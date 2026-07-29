import { createHash, timingSafeEqual } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException
} from "@nestjs/common";
import {
  domainEventTypes,
  integrationCapabilities,
  integrationProviders,
  projectConnectorBindingChangedFields,
  projectConnectorBindingAvailabilities,
  type IntegrationCapability,
  type IntegrationProvider,
  type InternalCreateProjectConnectorBindingInput,
  type InternalUpdateProjectConnectorBindingInput,
  type ProjectConnectorBinding,
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

const CAPABILITIES = new Set<string>(integrationCapabilities);
const PROVIDERS = new Set<string>(integrationProviders);
const AVAILABILITIES = new Set<string>(
  projectConnectorBindingAvailabilities
);
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
  deletedAt: true
} as const satisfies Prisma.IntegrationCredentialSelect;

const BINDING_INCLUDE = {
  routes: {
    include: {
      credential: {
        select: BINDING_CREDENTIAL_SELECT
      }
    },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }]
  }
} as const satisfies Prisma.ProjectConnectorBindingInclude;

type BindingRecord = Prisma.ProjectConnectorBindingGetPayload<{
  include: typeof BINDING_INCLUDE;
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
>;

const CREDENTIAL_OPTION_SELECT = {
  id: true,
  workspaceId: true,
  provider: true,
  label: true,
  mode: true,
  status: true,
  capabilities: true
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
        await assertCredentialAvailable(
          transaction,
          input.workspaceId,
          input.route.credentialId,
          input.capability
        );
        const binding =
          await transaction.projectConnectorBinding.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              capability: input.capability,
              enabled: input.enabled,
              createdBy: input.actorId,
              updatedBy: input.actorId
            }
          });
        await transaction.projectConnectorRoute.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            bindingId: binding.id,
            position: 0,
            sourceKind: "WORKSPACE_CREDENTIAL",
            credentialId: input.route.credentialId
          }
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
    const routeChanges =
      currentSummary.route.credentialId !== input.route.credentialId;

    return this.prisma.$transaction(async (transaction) => {
      if (input.enabled || routeChanges) {
        await assertCredentialAvailable(
          transaction,
          input.workspaceId,
          input.route.credentialId,
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

      const routeChanged =
        await transaction.projectConnectorRoute.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            bindingId,
            position: 0,
            sourceKind: "WORKSPACE_CREDENTIAL"
          },
          data: { credentialId: input.route.credentialId }
        });
      if (routeChanged.count !== 1) {
        throw new Error("Connector binding route projection is invalid");
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
    const snapshot = projectConnectorBindingSnapshot(
      receipt.responseSnapshot
    );
    if (
      snapshot.workspaceId !== input.workspaceId ||
      snapshot.projectId !== input.projectId ||
      snapshot.id !== receipt.bindingId
    ) {
      throw invalidStoredReceipt();
    }
    return snapshot;
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
  if (binding.routes.length !== 1) {
    throw new Error("Connector binding must contain exactly one route");
  }
  const route = binding.routes[0];
  if (
    !route ||
    route.workspaceId !== binding.workspaceId ||
    route.projectId !== binding.projectId ||
    route.bindingId !== binding.id ||
    route.position !== 0 ||
    route.sourceKind !== "WORKSPACE_CREDENTIAL" ||
    route.credential.workspaceId !== binding.workspaceId ||
    route.credentialId !== route.credential.id
  ) {
    throw new Error("Connector binding route projection is invalid");
  }
  const provider = providerValue(route.credential.provider);
  return {
    id: binding.id,
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    capability,
    enabled: binding.enabled,
    route: {
      id: route.id,
      bindingId: route.bindingId,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      position: 0,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: route.credentialId,
      provider,
      credentialMode: route.credential.mode,
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString()
    },
    fallbackPolicy: { mode: "NONE" },
    budgetPolicy: { mode: "DISABLED" },
    availability: bindingAvailability(binding.enabled, capability, {
      ...route.credential,
      provider
    }),
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
    )
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
  const payload = {
    bindingId: binding.id,
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    capability: binding.capability,
    enabled: binding.enabled,
    route: {
      position: binding.route.position,
      sourceKind: binding.route.sourceKind,
      provider: binding.route.provider,
      credentialMode: binding.route.credentialMode
    },
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
  if (
    previous.route.credentialId !== current.route.credentialId ||
    previous.route.provider !== current.route.provider ||
    previous.route.credentialMode !== current.route.credentialMode ||
    previous.route.sourceKind !== current.route.sourceKind ||
    previous.route.position !== current.route.position
  ) {
    fields.push("route");
  }
  if (previous.fallbackPolicy.mode !== current.fallbackPolicy.mode) {
    fields.push("fallbackPolicy");
  }
  if (previous.budgetPolicy.mode !== current.budgetPolicy.mode) {
    fields.push("budgetPolicy");
  }
  return fields;
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
  return {
    id: binding.id,
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    capability: binding.capability,
    enabled: binding.enabled,
    route: {
      id: binding.route.id,
      bindingId: binding.route.bindingId,
      workspaceId: binding.route.workspaceId,
      projectId: binding.route.projectId,
      position: binding.route.position,
      sourceKind: binding.route.sourceKind,
      credentialId: binding.route.credentialId,
      provider: binding.route.provider,
      credentialMode: binding.route.credentialMode,
      createdAt: binding.route.createdAt,
      updatedAt: binding.route.updatedAt
    },
    fallbackPolicy: { mode: binding.fallbackPolicy.mode },
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
  const binding = exactStoredRecord(value, [
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
  ]);
  const route = exactStoredRecord(binding.route, [
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
  const fallback = exactStoredRecord(binding.fallbackPolicy, ["mode"]);
  const budget = exactStoredRecord(binding.budgetPolicy, ["mode"]);
  const id = storedUuid(binding.id);
  const workspaceId = storedUuid(binding.workspaceId);
  const projectId = storedUuid(binding.projectId);
  const availability = storedString(binding.availability);
  const credentialMode = storedString(route.credentialMode);
  if (
    (binding.enabled !== true && binding.enabled !== false) ||
    !Number.isSafeInteger(binding.version) ||
    Number(binding.version) < 1 ||
    route.position !== 0 ||
    route.sourceKind !== "WORKSPACE_CREDENTIAL" ||
    fallback.mode !== "NONE" ||
    budget.mode !== "DISABLED" ||
    !AVAILABILITIES.has(availability) ||
    credentialMode !== "BYOK_API_KEY" ||
    availability !== (binding.enabled ? "READY" : "DISABLED")
  ) {
    throw invalidStoredReceipt();
  }
  const routeBindingId = storedUuid(route.bindingId);
  const routeWorkspaceId = storedUuid(route.workspaceId);
  const routeProjectId = storedUuid(route.projectId);
  if (
    routeBindingId !== id ||
    routeWorkspaceId !== workspaceId ||
    routeProjectId !== projectId
  ) {
    throw invalidStoredReceipt();
  }
  return {
    id,
    workspaceId,
    projectId,
    capability: capabilityValue(storedString(binding.capability)),
    enabled: binding.enabled,
    route: {
      id: storedUuid(route.id),
      bindingId: routeBindingId,
      workspaceId: routeWorkspaceId,
      projectId: routeProjectId,
      position: 0,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: storedUuid(route.credentialId),
      provider: providerValue(storedString(route.provider)),
      credentialMode:
        credentialMode as ProjectConnectorBinding["route"]["credentialMode"],
      createdAt: storedTimestamp(route.createdAt),
      updatedAt: storedTimestamp(route.updatedAt)
    },
    fallbackPolicy: { mode: "NONE" },
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

function versionConflict(currentVersion: number): PreconditionFailedException {
  return new PreconditionFailedException({
    code: "VERSION_CONFLICT",
    message: "Project connector binding version conflict",
    currentVersion
  });
}
