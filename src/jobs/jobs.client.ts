import { Inject, Injectable } from "@nestjs/common";
import {
  integrationCapabilities,
  integrationCredentialModes,
  integrationCredentialStatuses,
  integrationCredentialValidationModes,
  integrationCredentialValidationStatuses,
  integrationProviders,
  projectConnectorBindingAvailabilities,
  projectConnectorRouteSourceKinds
} from "@seo-platform/contracts";
import type {
  CompleteUploadInput,
  ConfigureSemanticImportInput,
  ConfirmSemanticImportInput,
  CancelSemanticImportInput,
  CreateSemanticImportInput,
  CreatedMultipartUpload,
  CreateUploadInput,
  CreateUploadPartUrlsInput,
  CreateIntegrationCredentialInput,
  IntegrationCredentialValidationSummary,
  IntegrationCredentialSummary,
  IntegrationProviderCatalogItem,
  CreateProjectConnectorBindingInput,
  InternalCreateIntegrationCredentialInput,
  InternalCreateIntegrationCredentialValidationInput,
  InternalCreateProjectConnectorBindingInput,
  InternalCreateRankEstimateInput,
  InternalDeleteIntegrationCredentialInput,
  InternalUpdateProjectConnectorBindingInput,
  InternalUpdateIntegrationCredentialInput,
  InternalCreateUploadInput,
  InternalCreateSemanticImportInput,
  InternalConfigureSemanticImportInput,
  InternalConfirmSemanticImportInput,
  InternalCancelSemanticImportInput,
  ProjectConnectorBinding,
  ProjectConnectorBindingsAggregate,
  ProjectConnectorBudgetPolicy,
  ProjectConnectorCredentialOption,
  ProjectConnectorFallbackPolicy,
  ProjectConnectorRoute,
  RankEstimate,
  SemanticImportSummary,
  UploadPartUrls,
  UploadSummary,
  UpdateIntegrationCredentialInput,
  UpdateProjectConnectorBindingInput
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { scopedRankEstimate } from "./rank-estimate-response.js";

interface InternalContext {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONNECTOR_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,31}$/u;
const PROVIDER_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/u;
const CAPABILITIES = new Set<string>(integrationCapabilities);
const CREDENTIAL_MODES = new Set<string>(integrationCredentialModes);
const CREDENTIAL_STATUSES = new Set<string>(
  integrationCredentialStatuses
);
const CREDENTIAL_VALIDATION_MODES = new Set<string>(
  integrationCredentialValidationModes
);
const CREDENTIAL_VALIDATION_STATUSES = new Set<string>(
  integrationCredentialValidationStatuses
);
const PROVIDERS = new Set<string>(integrationProviders);
const PROJECT_BINDING_AVAILABILITIES = new Set<string>(
  projectConnectorBindingAvailabilities
);
const PROJECT_ROUTE_SOURCE_KINDS = new Set<string>(
  projectConnectorRouteSourceKinds
);
const MAX_PROJECT_BINDINGS = integrationCapabilities.length;
const MAX_PROJECT_CREDENTIAL_OPTIONS = 500;

@Injectable()
export class JobsClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public createUpload(
    context: InternalContext,
    input: CreateUploadInput,
    idempotencyKey: string
  ): Promise<CreatedMultipartUpload> {
    const body: InternalCreateUploadInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId,
      idempotencyKey
    };
    return this.request("POST", "/internal/v1/uploads", context, body);
  }

  public createUploadPartUrls(
    context: InternalContext,
    uploadId: string,
    input: CreateUploadPartUrlsInput
  ): Promise<UploadPartUrls> {
    return this.request(
      "POST",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}/parts`,
      context,
      input
    );
  }

  public completeUpload(
    context: InternalContext,
    uploadId: string,
    input: CompleteUploadInput
  ): Promise<UploadSummary> {
    return this.request(
      "POST",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
      context,
      input
    );
  }

  public getUpload(
    context: InternalContext,
    uploadId: string
  ): Promise<UploadSummary> {
    return this.request(
      "GET",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}`,
      context
    );
  }

  public abortUpload(
    context: InternalContext,
    uploadId: string
  ): Promise<UploadSummary> {
    return this.request(
      "DELETE",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}`,
      context
    );
  }

  public createSemanticImport(
    context: InternalContext,
    input: CreateSemanticImportInput,
    idempotencyKey: string
  ): Promise<SemanticImportSummary> {
    const body: InternalCreateSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId,
      idempotencyKey
    };
    return this.request("POST", "/internal/v1/imports", context, body);
  }

  public getSemanticImport(
    context: InternalContext,
    importId: string
  ): Promise<SemanticImportSummary> {
    return this.request(
      "GET",
      `/internal/v1/imports/${encodeURIComponent(importId)}`,
      context
    );
  }

  public configureSemanticImport(
    context: InternalContext,
    importId: string,
    input: ConfigureSemanticImportInput
  ): Promise<SemanticImportSummary> {
    const body: InternalConfigureSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId
    };
    return this.request(
      "POST",
      `/internal/v1/imports/${encodeURIComponent(importId)}/mapping`,
      context,
      body
    );
  }

  public confirmSemanticImport(
    context: InternalContext,
    importId: string,
    input: ConfirmSemanticImportInput
  ): Promise<SemanticImportSummary> {
    const body: InternalConfirmSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId
    };
    return this.request(
      "POST",
      `/internal/v1/imports/${encodeURIComponent(importId)}/publish`,
      context,
      body
    );
  }

  public cancelSemanticImport(
    context: InternalContext,
    importId: string,
    input: CancelSemanticImportInput
  ): Promise<SemanticImportSummary> {
    const body: InternalCancelSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId
    };
    return this.request(
      "POST",
      `/internal/v1/imports/${encodeURIComponent(importId)}/cancel`,
      context,
      body
    );
  }

  public async integrationCatalog(
    context: InternalContext
  ): Promise<readonly IntegrationProviderCatalogItem[]> {
    const value = await this.requestIntegration<unknown>(
      "GET",
      integrationPath(context, "catalog"),
      context
    );
    return providerCatalog(value);
  }

  public async listIntegrationCredentials(
    context: InternalContext
  ): Promise<readonly IntegrationCredentialSummary[]> {
    const value = await this.requestIntegration<unknown>(
      "GET",
      integrationPath(context, "credentials"),
      context
    );
    return credentialCollection(value);
  }

  public async createIntegrationCredential(
    context: InternalContext,
    input: CreateIntegrationCredentialInput,
    idempotencyKey: string
  ): Promise<IntegrationCredentialSummary> {
    const body: InternalCreateIntegrationCredentialInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      idempotencyKey
    };
    const value = await this.requestIntegration<unknown>(
      "POST",
      integrationPath(context, "credentials"),
      context,
      body
    );
    return credentialSummary(value);
  }

  public async updateIntegrationCredential(
    context: InternalContext,
    credentialId: string,
    input: UpdateIntegrationCredentialInput,
    version: number
  ): Promise<IntegrationCredentialSummary> {
    const body: InternalUpdateIntegrationCredentialInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      version
    };
    const value = await this.requestIntegration<unknown>(
      "PATCH",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(credentialId)}`
      ),
      context,
      body
    );
    return credentialSummary(value);
  }

  public async createIntegrationCredentialValidation(
    context: InternalContext,
    credentialId: string,
    idempotencyKey: string
  ): Promise<IntegrationCredentialValidationSummary> {
    const body: InternalCreateIntegrationCredentialValidationInput = {
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      idempotencyKey
    };
    const value = await this.requestIntegration<unknown>(
      "POST",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(credentialId)}/validations`
      ),
      context,
      body
    );
    return scopedCredentialValidationSummary(
      value,
      context.tenant.workspaceId,
      credentialId
    );
  }

  public async getIntegrationCredentialValidation(
    context: InternalContext,
    credentialId: string,
    validationId: string
  ): Promise<IntegrationCredentialValidationSummary> {
    const value = await this.requestIntegration<unknown>(
      "GET",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(
          credentialId
        )}/validations/${encodeURIComponent(validationId)}`
      ),
      context
    );
    return scopedCredentialValidationSummary(
      value,
      context.tenant.workspaceId,
      credentialId,
      validationId
    );
  }

  public async revokeIntegrationCredential(
    context: InternalContext,
    credentialId: string,
    version: number
  ): Promise<void> {
    const body: InternalDeleteIntegrationCredentialInput = {
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      version
    };
    const value = await this.requestIntegration<unknown>(
      "DELETE",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(credentialId)}`
      ),
      context,
      body
    );
    if (
      typeof value !== "object" ||
      value === null ||
      !("revoked" in value) ||
      value.revoked !== true
    ) {
      throw invalidJobsResponse();
    }
  }

  public async projectConnectorBindings(
    context: InternalContext
  ): Promise<ProjectConnectorBindingsAggregate> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "GET",
      projectIntegrationPath(context, projectId),
      context
    );
    return projectConnectorBindingsAggregate(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async createProjectConnectorBinding(
    context: InternalContext,
    input: CreateProjectConnectorBindingInput,
    idempotencyKey: string
  ): Promise<ProjectConnectorBinding> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateProjectConnectorBindingInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey
    };
    const value = await this.requestIntegration<unknown>(
      "POST",
      projectIntegrationPath(context, projectId),
      context,
      body
    );
    return scopedProjectConnectorBinding(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async updateProjectConnectorBinding(
    context: InternalContext,
    bindingId: string,
    input: UpdateProjectConnectorBindingInput,
    version: number
  ): Promise<ProjectConnectorBinding> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalUpdateProjectConnectorBindingInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version
    };
    const value = await this.requestIntegration<unknown>(
      "PATCH",
      `${projectIntegrationPath(
        context,
        projectId
      )}/${encodeURIComponent(bindingId)}`,
      context,
      body
    );
    return scopedProjectConnectorBinding(
      value,
      context.tenant.workspaceId,
      projectId,
      bindingId
    );
  }

  public async createRankEstimate(
    context: InternalContext,
    input: InternalCreateRankEstimateInput,
    idempotencyKey: string
  ): Promise<RankEstimate> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "POST",
      `/internal/v1/workspaces/${encodeURIComponent(
        context.tenant.workspaceId
      )}/projects/${encodeURIComponent(projectId)}/rank-estimates`,
      context,
      input,
      idempotencyKey
    );
    return scopedRankEstimate(
      value,
      context.tenant.workspaceId,
      projectId,
      input.trackingContextId
    );
  }

  private requestIntegration<Data>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    context: InternalContext,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<Data> {
    return this.request(
      method,
      path,
      context,
      body,
      "integration-credential",
      idempotencyKey
    );
  }

  private async request<Data>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    context: InternalContext,
    body?: unknown,
    authentication: "shared" | "integration-credential" = "shared",
    idempotencyKey?: string
  ): Promise<Data> {
    const token =
      authentication === "integration-credential"
        ? this.config.integrationCredentialApiToken
        : this.config.internalApiToken;
    if (!token) throw dependencyUnavailable();
    const headers = new Headers({
      Accept: "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": context.requestId,
      "X-Workspace-Id": context.tenant.workspaceId,
      "X-Actor-Id": context.actorId
    });
    if (context.tenant.projectId) {
      headers.set("X-Project-Id", context.tenant.projectId);
    }
    if (idempotencyKey) {
      headers.set("Idempotency-Key", idempotencyKey);
    }
    if (body !== undefined) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetch(
        new URL(path, this.config.services.jobs),
        {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.config.internalCommandTimeoutMs)
        }
      );
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw upstreamError(response.status, payload);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload)
    ) {
      throw invalidJobsResponse();
    }
    return payload.data as Data;
  }
}

function integrationPath(
  context: InternalContext,
  suffix: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    context.tenant.workspaceId
  )}/integrations/${suffix}`;
}

function projectIntegrationPath(
  context: InternalContext,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    context.tenant.workspaceId
  )}/projects/${encodeURIComponent(projectId)}/integration-settings`;
}

function requiredProjectId(tenant: TenantAuthorization): string {
  if (!tenant.projectId) {
    throw new Error("Project authorization is required");
  }
  return tenant.projectId;
}

function dependencyUnavailable(): DomainError {
  return new DomainError({
    statusCode: 503,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service is temporarily unavailable",
    retryable: true
  });
}

function invalidJobsResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid response",
    retryable: true
  });
}

function upstreamError(status: number, payload: unknown): DomainError {
  if (status === 404) {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Resource not found"
    });
  }
  if (status === 409) {
    if (upstreamErrorCode(payload) === "IDEMPOTENCY_CONFLICT") {
      return new DomainError({
        statusCode: 409,
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key was already used for another request"
      });
    }
    if (upstreamErrorCode(payload) === "DUPLICATE") {
      return new DomainError({
        statusCode: 409,
        code: "DUPLICATE",
        message: "A project integration already exists"
      });
    }
    return new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Resource state does not allow this operation"
    });
  }
  if (status === 412) {
    const currentVersion = upstreamCurrentVersion(payload);
    return new DomainError({
      statusCode: 412,
      code: "VERSION_CONFLICT",
      message: "Resource version conflict",
      ...(currentVersion === undefined
        ? {}
        : { details: { currentVersion } })
    });
  }
  if (status === 400 || status === 422) {
    return new DomainError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "Jobs request is invalid"
    });
  }
  if (status === 413) {
    return new DomainError({
      statusCode: 413,
      code: "FILE_TOO_LARGE",
      message: "File exceeds the configured upload limit"
    });
  }
  return dependencyUnavailable();
}

function upstreamErrorCode(payload: unknown): string | undefined {
  const input = unknownRecord(payload);
  if (typeof input?.code === "string") return input.code;
  const error = unknownRecord(input?.error);
  return typeof error?.code === "string" ? error.code : undefined;
}

function upstreamCurrentVersion(payload: unknown): number | undefined {
  const input = unknownRecord(payload);
  const direct = input?.currentVersion;
  if (Number.isSafeInteger(direct) && Number(direct) > 0) {
    return Number(direct);
  }
  const details = unknownRecord(unknownRecord(input?.error)?.details);
  const nested = details?.currentVersion;
  return Number.isSafeInteger(nested) && Number(nested) > 0
    ? Number(nested)
    : undefined;
}

function projectConnectorBindingsAggregate(
  value: unknown,
  workspaceId: string,
  projectId: string
): ProjectConnectorBindingsAggregate {
  const input = exactRecord(value, [
    "bindings",
    "credentialOptions",
    "credentialOptionsTruncated"
  ]);
  if (
    !Array.isArray(input.bindings) ||
    input.bindings.length > MAX_PROJECT_BINDINGS ||
    !Array.isArray(input.credentialOptions) ||
    input.credentialOptions.length > MAX_PROJECT_CREDENTIAL_OPTIONS ||
    typeof input.credentialOptionsTruncated !== "boolean"
  ) {
    throw invalidJobsResponse();
  }

  const bindings = input.bindings.map((binding) =>
    scopedProjectConnectorBinding(binding, workspaceId, projectId)
  );
  const credentialOptions = input.credentialOptions.map((credential) =>
    projectConnectorCredentialOption(credential, workspaceId)
  );
  assertUnique(
    bindings.map(({ id }) => id),
    bindings.map(({ capability }) => capability),
    credentialOptions.map(({ id }) => id)
  );

  const credentialsById = new Map(
    credentialOptions.map((credential) => [credential.id, credential])
  );
  for (const binding of bindings) {
    const credential = credentialsById.get(binding.route.credentialId);
    if (
      credential &&
      (credential.provider !== binding.route.provider ||
        credential.mode !== binding.route.credentialMode)
    ) {
      throw invalidJobsResponse();
    }
    if (
      binding.availability !==
      expectedProjectBindingAvailability(binding, credential)
    ) {
      throw invalidJobsResponse();
    }
  }
  return {
    bindings,
    credentialOptions,
    credentialOptionsTruncated: input.credentialOptionsTruncated
  };
}

function expectedProjectBindingAvailability(
  binding: ProjectConnectorBinding,
  credential: ProjectConnectorCredentialOption | undefined
): ProjectConnectorBinding["availability"] {
  if (!binding.enabled) return "DISABLED";
  if (!credential) return "CREDENTIAL_UNAVAILABLE";
  if (credential.status === "PENDING_VERIFICATION") {
    return "CREDENTIAL_PENDING";
  }
  if (
    credential.status !== "ACTIVE" ||
    credential.mode !== "BYOK_API_KEY"
  ) {
    return "CREDENTIAL_UNAVAILABLE";
  }
  return credential.capabilities.includes(binding.capability)
    ? "READY"
    : "CAPABILITY_MISMATCH";
}

function scopedProjectConnectorBinding(
  value: unknown,
  workspaceId: string,
  projectId: string,
  bindingId?: string
): ProjectConnectorBinding {
  const input = exactRecord(value, [
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
  const id = uuidValue(input.id);
  const responseWorkspaceId = uuidValue(input.workspaceId);
  const responseProjectId = uuidValue(input.projectId);
  const capability = capabilityValue(input.capability);
  const availability = projectBindingAvailabilityValue(
    input.availability
  );
  const route = projectConnectorRoute(
    input.route,
    responseWorkspaceId,
    responseProjectId,
    id
  );
  const version = positiveInteger(input.version);
  const createdBy = uuidValue(input.createdBy);
  const updatedBy = uuidValue(input.updatedBy);
  const createdAt = isoDateValue(input.createdAt);
  const updatedAt = isoDateValue(input.updatedAt);
  if (
    responseWorkspaceId !== workspaceId ||
    responseProjectId !== projectId ||
    (bindingId !== undefined && id !== bindingId) ||
    typeof input.enabled !== "boolean"
  ) {
    throw invalidJobsResponse();
  }
  return {
    id,
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    capability,
    enabled: input.enabled,
    route,
    fallbackPolicy: projectFallbackPolicy(input.fallbackPolicy),
    budgetPolicy: projectBudgetPolicy(input.budgetPolicy),
    availability,
    version,
    createdBy,
    updatedBy,
    createdAt,
    updatedAt
  };
}

function projectConnectorRoute(
  value: unknown,
  workspaceId: string,
  projectId: string,
  bindingId: string
): ProjectConnectorRoute {
  const input = exactRecord(value, [
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
  const routeWorkspaceId = uuidValue(input.workspaceId);
  const routeProjectId = uuidValue(input.projectId);
  const routeBindingId = uuidValue(input.bindingId);
  const sourceKind = projectRouteSourceKindValue(input.sourceKind);
  const credentialMode = credentialModeValue(input.credentialMode);
  if (
    routeWorkspaceId !== workspaceId ||
    routeProjectId !== projectId ||
    routeBindingId !== bindingId ||
    input.position !== 0
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: uuidValue(input.id),
    bindingId: routeBindingId,
    workspaceId: routeWorkspaceId,
    projectId: routeProjectId,
    position: 0,
    sourceKind,
    credentialId: uuidValue(input.credentialId),
    provider: providerValue(input.provider),
    credentialMode,
    createdAt: isoDateValue(input.createdAt),
    updatedAt: isoDateValue(input.updatedAt)
  };
}

function projectConnectorCredentialOption(
  value: unknown,
  workspaceId: string
): ProjectConnectorCredentialOption {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "provider",
    "label",
    "mode",
    "status",
    "capabilities"
  ]);
  const responseWorkspaceId = uuidValue(input.workspaceId);
  const capabilities = stringArray(input.capabilities);
  if (
    responseWorkspaceId !== workspaceId ||
    typeof input.label !== "string" ||
    input.label.length === 0 ||
    input.label.length > 160 ||
    input.label !== input.label.trim() ||
    capabilities.length > integrationCapabilities.length ||
    new Set(capabilities).size !== capabilities.length ||
    capabilities.some((capability) => !CAPABILITIES.has(capability))
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: uuidValue(input.id),
    workspaceId: responseWorkspaceId,
    provider: providerValue(input.provider),
    label: input.label,
    mode: credentialModeValue(input.mode),
    status: credentialStatusValue(input.status),
    capabilities:
      capabilities as ProjectConnectorCredentialOption["capabilities"]
  };
}

function projectFallbackPolicy(
  value: unknown
): ProjectConnectorFallbackPolicy {
  const input = exactRecord(value, ["mode"]);
  if (input.mode !== "NONE") throw invalidJobsResponse();
  return { mode: "NONE" };
}

function projectBudgetPolicy(value: unknown): ProjectConnectorBudgetPolicy {
  const input = exactRecord(value, ["mode"]);
  if (input.mode !== "DISABLED") throw invalidJobsResponse();
  return { mode: "DISABLED" };
}

function capabilityValue(
  value: unknown
): ProjectConnectorBinding["capability"] {
  if (typeof value !== "string" || !CAPABILITIES.has(value)) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorBinding["capability"];
}

function projectBindingAvailabilityValue(
  value: unknown
): ProjectConnectorBinding["availability"] {
  if (
    typeof value !== "string" ||
    !PROJECT_BINDING_AVAILABILITIES.has(value)
  ) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorBinding["availability"];
}

function projectRouteSourceKindValue(
  value: unknown
): ProjectConnectorRoute["sourceKind"] {
  if (
    typeof value !== "string" ||
    !PROJECT_ROUTE_SOURCE_KINDS.has(value)
  ) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorRoute["sourceKind"];
}

function credentialModeValue(
  value: unknown
): ProjectConnectorCredentialOption["mode"] {
  if (typeof value !== "string" || !CREDENTIAL_MODES.has(value)) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorCredentialOption["mode"];
}

function credentialStatusValue(
  value: unknown
): ProjectConnectorCredentialOption["status"] {
  if (typeof value !== "string" || !CREDENTIAL_STATUSES.has(value)) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorCredentialOption["status"];
}

function uuidValue(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidJobsResponse();
  }
  return value.toLowerCase();
}

function isoDateValue(value: unknown): string {
  if (typeof value !== "string" || !isIsoDate(value)) {
    throw invalidJobsResponse();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw invalidJobsResponse();
  }
  return Number(value);
}

function assertUnique(...collections: readonly (readonly string[])[]): void {
  if (
    collections.some(
      (collection) => new Set(collection).size !== collection.length
    )
  ) {
    throw invalidJobsResponse();
  }
}

function providerCatalog(
  value: unknown
): readonly IntegrationProviderCatalogItem[] {
  if (!Array.isArray(value)) throw invalidJobsResponse();
  return value.map((item) => {
    const input = record(item);
    const provider = providerValue(input.provider);
    const credentialValidationMode = credentialValidationModeValue(
      input.credentialValidationMode
    );
    const capabilities = stringArray(input.capabilities);
    const supportedModes = stringArray(input.supportedModes);
    if (
      typeof input.displayName !== "string" ||
      typeof input.description !== "string" ||
      typeof input.requiresAccountIdentifier !== "boolean" ||
      typeof input.subscriptionNotice !== "string" ||
      (input.accountIdentifierLabel !== undefined &&
        typeof input.accountIdentifierLabel !== "string") ||
      capabilities.some((capability) => !CAPABILITIES.has(capability)) ||
      supportedModes.length === 0 ||
      supportedModes.some((mode) => !CREDENTIAL_MODES.has(mode))
    ) {
      throw invalidJobsResponse();
    }
    return {
      provider,
      displayName: input.displayName,
      description: input.description,
      capabilities:
        capabilities as IntegrationProviderCatalogItem["capabilities"],
      supportedModes:
        supportedModes as IntegrationProviderCatalogItem["supportedModes"],
      credentialValidationMode,
      requiresAccountIdentifier: input.requiresAccountIdentifier,
      ...(typeof input.accountIdentifierLabel === "string"
        ? { accountIdentifierLabel: input.accountIdentifierLabel }
        : {}),
      subscriptionNotice: input.subscriptionNotice
    };
  });
}

function credentialCollection(
  value: unknown
): readonly IntegrationCredentialSummary[] {
  if (!Array.isArray(value)) throw invalidJobsResponse();
  return value.map(credentialSummary);
}

function credentialSummary(value: unknown): IntegrationCredentialSummary {
  const input = record(value);
  const provider = providerValue(input.provider);
  const capabilities = stringArray(input.capabilities);
  if (
    typeof input.id !== "string" ||
    !UUID_PATTERN.test(input.id) ||
    typeof input.workspaceId !== "string" ||
    !UUID_PATTERN.test(input.workspaceId) ||
    typeof input.label !== "string" ||
    typeof input.mode !== "string" ||
    !CREDENTIAL_MODES.has(input.mode) ||
    typeof input.status !== "string" ||
    !CREDENTIAL_STATUSES.has(input.status) ||
    typeof input.displayHint !== "string" ||
    capabilities.some((capability) => !CAPABILITIES.has(capability)) ||
    !Number.isSafeInteger(input.version) ||
    typeof input.createdAt !== "string" ||
    !isIsoDate(input.createdAt) ||
    typeof input.updatedAt !== "string" ||
    !isIsoDate(input.updatedAt) ||
    (input.verifiedAt !== undefined &&
      (typeof input.verifiedAt !== "string" ||
        !isIsoDate(input.verifiedAt))) ||
    (input.lastSuccessAt !== undefined &&
      (typeof input.lastSuccessAt !== "string" ||
        !isIsoDate(input.lastSuccessAt))) ||
    (input.lastErrorAt !== undefined &&
      (typeof input.lastErrorAt !== "string" ||
        !isIsoDate(input.lastErrorAt))) ||
    (input.lastErrorCode !== undefined &&
      (typeof input.lastErrorCode !== "string" ||
        !PROVIDER_ERROR_CODE_PATTERN.test(input.lastErrorCode)))
  ) {
    throw invalidJobsResponse();
  }
  const activeValidation =
    input.activeValidation === undefined
      ? undefined
      : credentialValidationSummary(input.activeValidation);
  if (
    activeValidation &&
    (activeValidation.workspaceId !== input.workspaceId ||
      activeValidation.credentialId !== input.id ||
      activeValidation.provider !== provider ||
      ![
        "QUEUED",
        "RUNNING",
        "RETRY_SCHEDULED"
      ].includes(activeValidation.status))
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    provider,
    label: input.label,
    mode: input.mode as IntegrationCredentialSummary["mode"],
    status:
      input.status as IntegrationCredentialSummary["status"],
    displayHint: input.displayHint,
    capabilities:
      capabilities as IntegrationCredentialSummary["capabilities"],
    ...(typeof input.verifiedAt === "string"
      ? { verifiedAt: input.verifiedAt }
      : {}),
    ...(typeof input.lastSuccessAt === "string"
      ? { lastSuccessAt: input.lastSuccessAt }
      : {}),
    ...(typeof input.lastErrorAt === "string"
      ? { lastErrorAt: input.lastErrorAt }
      : {}),
    ...(typeof input.lastErrorCode === "string"
      ? { lastErrorCode: input.lastErrorCode }
      : {}),
    ...(activeValidation ? { activeValidation } : {}),
    version: Number(input.version),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function credentialValidationSummary(
  value: unknown
): IntegrationCredentialValidationSummary {
  const input = record(value);
  const provider = providerValue(input.provider);
  if (
    typeof input.id !== "string" ||
    !UUID_PATTERN.test(input.id) ||
    typeof input.workspaceId !== "string" ||
    !UUID_PATTERN.test(input.workspaceId) ||
    typeof input.credentialId !== "string" ||
    !UUID_PATTERN.test(input.credentialId) ||
    !Number.isSafeInteger(input.credentialMaterialVersion) ||
    Number(input.credentialMaterialVersion) < 1 ||
    typeof input.status !== "string" ||
    !CREDENTIAL_VALIDATION_STATUSES.has(input.status) ||
    (input.errorCode !== undefined &&
      (typeof input.errorCode !== "string" ||
        !PROVIDER_ERROR_CODE_PATTERN.test(input.errorCode))) ||
    typeof input.connectorVersion !== "string" ||
    !CONNECTOR_VERSION_PATTERN.test(input.connectorVersion) ||
    typeof input.requestedAt !== "string" ||
    !isIsoDate(input.requestedAt) ||
    (input.startedAt !== undefined &&
      (typeof input.startedAt !== "string" ||
        !isIsoDate(input.startedAt))) ||
    (input.retryAt !== undefined &&
      (typeof input.retryAt !== "string" ||
        !isIsoDate(input.retryAt))) ||
    (input.finishedAt !== undefined &&
      (typeof input.finishedAt !== "string" ||
        !isIsoDate(input.finishedAt)))
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    credentialId: input.credentialId,
    credentialMaterialVersion: Number(
      input.credentialMaterialVersion
    ),
    provider,
    status:
      input.status as IntegrationCredentialValidationSummary["status"],
    ...(typeof input.errorCode === "string"
      ? { errorCode: input.errorCode }
      : {}),
    connectorVersion: input.connectorVersion,
    requestedAt: input.requestedAt,
    ...(typeof input.startedAt === "string"
      ? { startedAt: input.startedAt }
      : {}),
    ...(typeof input.retryAt === "string"
      ? { retryAt: input.retryAt }
      : {}),
    ...(typeof input.finishedAt === "string"
      ? { finishedAt: input.finishedAt }
      : {})
  };
}

function scopedCredentialValidationSummary(
  value: unknown,
  workspaceId: string,
  credentialId: string,
  validationId?: string
): IntegrationCredentialValidationSummary {
  const result = credentialValidationSummary(value);
  if (
    result.workspaceId !== workspaceId ||
    result.credentialId !== credentialId ||
    (validationId !== undefined && result.id !== validationId)
  ) {
    throw invalidJobsResponse();
  }
  return result;
}

function providerValue(
  value: unknown
): IntegrationCredentialSummary["provider"] {
  if (typeof value !== "string" || !PROVIDERS.has(value)) {
    throw invalidJobsResponse();
  }
  return value as IntegrationCredentialSummary["provider"];
}

function credentialValidationModeValue(
  value: unknown
): IntegrationProviderCatalogItem["credentialValidationMode"] {
  if (
    typeof value !== "string" ||
    !CREDENTIAL_VALIDATION_MODES.has(value)
  ) {
    throw invalidJobsResponse();
  }
  return value as IntegrationProviderCatalogItem["credentialValidationMode"];
}

function isIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidJobsResponse();
  }
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidJobsResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field))
  ) {
    throw invalidJobsResponse();
  }
  return input;
}

function unknownRecord(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
