import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticNegativeKeywordApplyResult,
  SemanticNegativeKeywordPreset,
  SemanticNegativeKeywordPreview
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalApplyNegativeKeywordsInput,
  internalCreateNegativeKeywordPresetInput,
  internalDeleteNegativeKeywordPresetInput,
  internalNegativeKeywordCommandInput,
  internalUpdateNegativeKeywordPresetInput
} from "./negative-keyword-input.js";
import { NegativeKeywordService } from "./negative-keyword.service.js";

type InternalHeaders = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId")
@UseGuards(PlatformApiGuard)
export class NegativeKeywordController {
  public constructor(private readonly negativeKeywords: NegativeKeywordService) {}

  @Get("negative-keyword-presets")
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticNegativeKeywordPreset[]>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.negativeKeywords.list(context.workspaceId, context.projectId),
      meta: { requestId: request.id }
    };
  }

  @Post("negative-keyword-presets")
  public async create(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticNegativeKeywordPreset>> {
    const input = internalCreateNegativeKeywordPresetInput(body);
    assertMutation(projectId, headers, input);
    return response(request, await this.negativeKeywords.create(input));
  }

  @Patch("negative-keyword-presets/:presetId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("presetId") presetId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticNegativeKeywordPreset>> {
    const input = internalUpdateNegativeKeywordPresetInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.negativeKeywords.update(internalUuid(presetId, "presetId"), input)
    );
  }

  @Delete("negative-keyword-presets/:presetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param("projectId") projectId: string,
    @Param("presetId") presetId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown
  ): Promise<void> {
    const input = internalDeleteNegativeKeywordPresetInput(body);
    assertMutation(projectId, headers, input);
    await this.negativeKeywords.delete(internalUuid(presetId, "presetId"), input);
  }

  @Post("negative-keywords/preview")
  public async preview(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticNegativeKeywordPreview>> {
    const input = internalNegativeKeywordCommandInput(body);
    assertMutation(projectId, headers, input);
    return { data: await this.negativeKeywords.preview(input), meta: { requestId: request.id } };
  }

  @Post("negative-keywords/apply")
  public async apply(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticNegativeKeywordApplyResult>> {
    const input = internalApplyNegativeKeywordsInput(body);
    assertMutation(projectId, headers, input);
    return { data: await this.negativeKeywords.apply(input), meta: { requestId: request.id } };
  }
}

function routeContext(projectId: string, headers: InternalHeaders) {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) {
    throw new BadRequestException("Route project identifier does not match trusted context");
  }
  return context;
}

function assertMutation(
  projectId: string,
  headers: InternalHeaders,
  input: { readonly workspaceId: string; readonly projectId: string; readonly actorId: string }
): void {
  assertInternalContext(routeContext(projectId, headers), input);
}

function response(
  request: FastifyRequest,
  data: SemanticNegativeKeywordPreset
): ApiResponse<SemanticNegativeKeywordPreset> {
  return { data, meta: { requestId: request.id, version: data.version } };
}
