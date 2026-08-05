import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ProjectConnectorBinding,
  ProjectConnectorBindingsAggregate
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid,
  type InternalCommandContext
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import {
  internalInheritProjectConnectorBindingInput,
  internalCreateProjectConnectorBindingInput,
  internalUpdateProjectConnectorBindingInput
} from "./project-connector-binding-input.js";
import { ProjectConnectorBindingService } from "./project-connector-binding.service.js";

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/integration-settings"
)
@UseGuards(IntegrationCredentialApiGuard)
export class ProjectConnectorBindingController {
  public constructor(
    private readonly bindings: ProjectConnectorBindingService
  ) {}

  @Get()
  public async aggregate(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectConnectorBindingsAggregate>> {
    const context = projectContext(workspaceId, projectId, headers);
    return response(
      request,
      await this.bindings.aggregate(context.workspaceId, context.projectId)
    );
  }

  @Post()
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectConnectorBinding>> {
    const context = projectContext(workspaceId, projectId, headers);
    const input = internalCreateProjectConnectorBindingInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.bindings.create(input, request.id)
    );
  }

  @Patch(":bindingId")
  public async update(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectConnectorBinding>> {
    const context = projectContext(workspaceId, projectId, headers);
    const input = internalUpdateProjectConnectorBindingInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.bindings.update(
        internalUuid(bindingId, "bindingId"),
        input,
        request.id
      )
    );
  }

  @Post(":bindingId/inherit")
  public async inheritWorkspaceRoute(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectConnectorBinding>> {
    const context = projectContext(workspaceId, projectId, headers);
    const input = internalInheritProjectConnectorBindingInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.bindings.inheritWorkspaceRoute(
        internalUuid(bindingId, "bindingId"),
        input,
        request.id
      )
    );
  }
}

function projectContext(
  workspaceId: string,
  projectId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>
): InternalCommandContext {
  const context = internalCommandContext(headers);
  assertInternalContext(
    {
      workspaceId: internalUuid(workspaceId, "workspaceId"),
      projectId: internalUuid(projectId, "projectId"),
      actorId: context.actorId
    },
    context
  );
  return context;
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return {
    data,
    meta: { requestId: request.id }
  };
}
