import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  IntegrationCredentialValidationSummary,
  IntegrationCredentialSummary,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  assertInternalWorkspaceContext,
  internalUuid,
  internalWorkspaceCommandContext
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import {
  internalCreateIntegrationCredentialInput,
  internalCreateIntegrationCredentialValidationInput,
  internalDeleteIntegrationCredentialInput,
  internalEnablePlatformIntegrationCredentialInput,
  internalUpdateIntegrationCredentialInput
} from "./integration-credential-input.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import { IntegrationCredentialValidationService } from "./integration-credential-validation.service.js";
import { operationalIntegrationProviderCatalogForPlatform } from "./integration-provider-catalog.js";

@Controller("internal/v1/workspaces/:workspaceId/integrations")
@UseGuards(IntegrationCredentialApiGuard)
export class IntegrationCredentialController {
  public constructor(
    private readonly credentials: IntegrationCredentialService,
    private readonly validations: IntegrationCredentialValidationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Get("catalog")
  public catalog(
    @Param("workspaceId") workspaceId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): ApiResponse<readonly IntegrationProviderCatalogItem[]> {
    workspaceContext(workspaceId, headers);
    return response(
      request,
      operationalIntegrationProviderCatalogForPlatform(
        configuredPlatformProviders(this.config)
      )
    );
  }

  @Post("platform-credentials")
  public async enablePlatform(
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<IntegrationCredentialSummary>> {
    const context = workspaceContext(workspaceId, headers);
    const input = internalEnablePlatformIntegrationCredentialInput(body);
    assertInternalWorkspaceContext(input, context);
    const material = this.config.platformProviderCredentials[input.provider];
    if (!material) {
      throw new ServiceUnavailableException(
        "Platform provider credential is not configured"
      );
    }
    return response(
      request,
      await this.credentials.enablePlatform(input, material)
    );
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

  @Post("credentials/:credentialId/validations")
  @HttpCode(HttpStatus.ACCEPTED)
  public async validate(
    @Param("workspaceId") workspaceId: string,
    @Param("credentialId") credentialId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<IntegrationCredentialValidationSummary>> {
    const context = workspaceContext(workspaceId, headers);
    const input = internalCreateIntegrationCredentialValidationInput(body);
    assertInternalWorkspaceContext(input, context);
    return response(
      request,
      await this.validations.request(
        internalUuid(credentialId, "credentialId"),
        input,
        request.id
      )
    );
  }

  @Get("credentials/:credentialId/validations/:validationId")
  public async validation(
    @Param("workspaceId") workspaceId: string,
    @Param("credentialId") credentialId: string,
    @Param("validationId") validationId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<IntegrationCredentialValidationSummary>> {
    const context = workspaceContext(workspaceId, headers);
    return response(
      request,
      await this.validations.get(
        internalUuid(credentialId, "credentialId"),
        internalUuid(validationId, "validationId"),
        context.workspaceId
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

function configuredPlatformProviders(
  config: AppConfig
): ReadonlySet<"XMLSTOCK" | "ARSENKIN"> {
  const providers = new Set<"XMLSTOCK" | "ARSENKIN">();
  if (config.platformProviderCredentials.XMLSTOCK) {
    providers.add("XMLSTOCK");
  }
  if (config.platformProviderCredentials.ARSENKIN) {
    providers.add("ARSENKIN");
  }
  return providers;
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
