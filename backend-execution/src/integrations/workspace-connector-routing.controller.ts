import { Body, Controller, Get, Headers, Param, Put, Req, UseGuards } from "@nestjs/common";
import {
  integrationCapabilities,
  type ApiResponse,
  type IntegrationCapability,
  type WorkspaceConnectorBinding,
  type WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalWorkspaceContext,
  internalUuid,
  internalWorkspaceCommandContext
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import { internalUpsertWorkspaceConnectorBindingInput } from "./workspace-connector-routing-input.js";
import { WorkspaceConnectorRoutingService } from "./workspace-connector-routing.service.js";

const CAPABILITIES = new Set<string>(integrationCapabilities);

@Controller("internal/v1/workspaces/:workspaceId/integration-routing")
@UseGuards(IntegrationCredentialApiGuard)
export class WorkspaceConnectorRoutingController {
  public constructor(private readonly routing: WorkspaceConnectorRoutingService) {}

  @Get()
  public async settings(
    @Param("workspaceId") workspaceId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WorkspaceConnectorRoutingSettings>> {
    const context = workspaceContext(workspaceId, headers);
    return response(request, await this.routing.settings(context.workspaceId));
  }

  @Put(":capability")
  public async upsert(
    @Param("workspaceId") workspaceId: string,
    @Param("capability") capabilityValue: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WorkspaceConnectorBinding>> {
    const context = workspaceContext(workspaceId, headers);
    const capability = capabilityPath(capabilityValue);
    const input = internalUpsertWorkspaceConnectorBindingInput(body);
    assertInternalWorkspaceContext(input, context);
    if (input.capability !== capability) throw new Error("Capability context mismatch");
    return response(request, await this.routing.upsert(input));
  }
}

function workspaceContext(
  workspaceId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>
): { readonly workspaceId: string; readonly actorId: string } {
  const context = internalWorkspaceCommandContext(headers);
  assertInternalWorkspaceContext(
    { workspaceId: internalUuid(workspaceId, "workspaceId"), actorId: context.actorId },
    context
  );
  return context;
}

function capabilityPath(value: string): IntegrationCapability {
  if (!CAPABILITIES.has(value)) throw new Error("Unsupported capability path");
  return value as IntegrationCapability;
}

function response<Data>(request: FastifyRequest, data: Data): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
