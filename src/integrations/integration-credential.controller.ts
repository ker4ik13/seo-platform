import {
  Body,
  Controller,
  Delete,
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
  IntegrationCredentialSummary,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalWorkspaceContext,
  internalUuid,
  internalWorkspaceCommandContext
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import {
  internalCreateIntegrationCredentialInput,
  internalDeleteIntegrationCredentialInput,
  internalUpdateIntegrationCredentialInput
} from "./integration-credential-input.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import { integrationProviderCatalog } from "./integration-provider-catalog.js";

@Controller("internal/v1/workspaces/:workspaceId/integrations")
@UseGuards(IntegrationCredentialApiGuard)
export class IntegrationCredentialController {
  public constructor(
    private readonly credentials: IntegrationCredentialService
  ) {}

  @Get("catalog")
  public catalog(
    @Param("workspaceId") workspaceId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): ApiResponse<readonly IntegrationProviderCatalogItem[]> {
    workspaceContext(workspaceId, headers);
    return response(request, integrationProviderCatalog);
  }

  @Get("credentials")
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly IntegrationCredentialSummary[]>> {
    const context = workspaceContext(workspaceId, headers);
    return response(
      request,
      await this.credentials.list(context.workspaceId)
    );
  }

  @Post("credentials")
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<IntegrationCredentialSummary>> {
    const context = workspaceContext(workspaceId, headers);
    const input = internalCreateIntegrationCredentialInput(body);
    assertInternalWorkspaceContext(input, context);
    return response(
      request,
      await this.credentials.create(input)
    );
  }

  @Patch("credentials/:credentialId")
  public async update(
    @Param("workspaceId") workspaceId: string,
    @Param("credentialId") credentialId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<IntegrationCredentialSummary>> {
    const context = workspaceContext(workspaceId, headers);
    const input = internalUpdateIntegrationCredentialInput(body);
    assertInternalWorkspaceContext(input, context);
    return response(
      request,
      await this.credentials.update(
        internalUuid(credentialId, "credentialId"),
        input
      )
    );
  }

  @Delete("credentials/:credentialId")
  public async revoke(
    @Param("workspaceId") workspaceId: string,
    @Param("credentialId") credentialId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly revoked: true }>> {
    const context = workspaceContext(workspaceId, headers);
    const input = internalDeleteIntegrationCredentialInput(body);
    assertInternalWorkspaceContext(input, context);
    await this.credentials.revoke(
      internalUuid(credentialId, "credentialId"),
      context.workspaceId,
      input.version,
      input.actorId
    );
    return response(request, { revoked: true });
  }
}

function workspaceContext(
  workspaceId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>
): { readonly workspaceId: string; readonly actorId: string } {
  const context = internalWorkspaceCommandContext(headers);
  assertInternalWorkspaceContext(
    {
      workspaceId: internalUuid(workspaceId, "workspaceId"),
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
