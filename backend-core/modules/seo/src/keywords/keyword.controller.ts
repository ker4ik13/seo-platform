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
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  semanticFrequencyDevices,
  semanticFrequencyTypes
} from "@seo-platform/contracts";
import type {
  SemanticFrequencyDevice,
  SemanticFrequencyType,
  ApiCollectionResponse,
  ApiResponse,
  SemanticKeywordBulkCreatePreviewResult,
  SemanticKeywordBulkCreateResult,
  SemanticKeywordBulkResult,
  SemanticKeywordCleaningPreview,
  SemanticKeywordCleaningResult,
  SemanticKeywordListItem,
  SemanticKeywordInsights,
  ProjectPositionSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCreateSemanticKeywordInput,
  internalDeleteSemanticKeywordInput,
  internalSemanticKeywordBulkCreateInput,
  internalSemanticKeywordBulkCreatePreviewInput,
  internalSemanticKeywordBulkInput,
  internalSemanticKeywordCleaningInput,
  internalUpdateSemanticKeywordInput
} from "./keyword-input.js";
import {
  keywordListQuery,
  keywordTagOptionsQuery
} from "./keyword-query.js";
import { KeywordService } from "./keyword.service.js";

@Controller("internal/v1/projects/:projectId/keywords")
@UseGuards(PlatformApiGuard)
export class KeywordController {
  public constructor(private readonly keywords: KeywordService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = internalCommandContext(headers);
    if (internalUuid(projectId, "projectId") !== context.projectId) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    return this.keywords.list(
      context.workspaceId,
      context.projectId,
      keywordListQuery(query),
      request.id
    );
  }

  @Get("tag-options")
  public async tagOptions(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly string[]>> {
    const context = internalCommandContext(headers);
    if (internalUuid(projectId, "projectId") !== context.projectId) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    const { search } = keywordTagOptionsQuery(query);
    return {
      data: await this.keywords.tagOptions(
        context.workspaceId,
        context.projectId,
        search
      ),
      meta: { requestId: request.id }
    };
  }

  @Get("position-summary")
  public async positionSummary(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectPositionSummary>> {
    const context = internalCommandContext(headers);
    if (internalUuid(projectId, "projectId") !== context.projectId) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    return {
      data: await this.keywords.positionSummary(
        context.workspaceId,
        context.projectId
      ),
      meta: { requestId: request.id }
    };
  }

  @Post()
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordListItem>> {
    const input = internalCreateSemanticKeywordInput(body);
    assertMutationContext(projectId, headers, input);
    const result = await this.keywords.create(input);
    return response(request, result);
  }

  @Post("bulk")
  public async bulkUpdate(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordBulkResult>> {
    const input = internalSemanticKeywordBulkInput(body);
    assertMutationContext(projectId, headers, input);
    return {
      data: await this.keywords.bulkUpdate(input),
      meta: { requestId: request.id }
    };
  }

  @Post("bulk-create")
  public async bulkCreate(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordBulkCreateResult>> {
    const input = internalSemanticKeywordBulkCreateInput(body);
    assertMutationContext(projectId, headers, input);
    return {
      data: await this.keywords.bulkCreate(input),
      meta: { requestId: request.id }
    };
  }

  @Post("bulk-create-preview")
  public async previewBulkCreate(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordBulkCreatePreviewResult>> {
    const input = internalSemanticKeywordBulkCreatePreviewInput(body);
    assertMutationContext(projectId, headers, input);
    return {
      data: await this.keywords.previewBulkCreate(input),
      meta: { requestId: request.id }
    };
  }

  @Post("bulk-clean-preview")
  public async previewCleaning(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordCleaningPreview>> {
    const input = internalSemanticKeywordCleaningInput(body);
    assertMutationContext(projectId, headers, input);
    return {
      data: await this.keywords.previewCleaning(input),
      meta: { requestId: request.id }
    };
  }

  @Post("bulk-clean")
  public async clean(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordCleaningResult>> {
    const input = internalSemanticKeywordCleaningInput(body);
    assertMutationContext(projectId, headers, input);
    return {
      data: await this.keywords.clean(input),
      meta: { requestId: request.id }
    };
  }

  @Get(":keywordId/insights")
  public async insights(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordInsights>> {
    const context = internalCommandContext(headers);
    if (internalUuid(projectId, "projectId") !== context.projectId) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    return {
      data: await this.keywords.insights(
        context.workspaceId,
        context.projectId,
        internalUuid(keywordId, "keywordId")
      ),
      meta: { requestId: request.id }
    };
  }

  @Delete(":keywordId/frequencies/:type/:device")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async deleteFrequencyContext(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Param("type") type: string,
    @Param("device") device: string,
    @Query("regionCode") regionCode: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>
  ): Promise<void> {
    const context = internalCommandContext(headers);
    if (internalUuid(projectId, "projectId") !== context.projectId) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    await this.keywords.deleteFrequencyContext(
      context.workspaceId,
      context.projectId,
      internalUuid(keywordId, "keywordId"),
      internalFrequencyType(type),
      internalFrequencyRegion(regionCode),
      internalFrequencyDevice(device)
    );
  }

  @Patch(":keywordId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordListItem>> {
    const input = internalUpdateSemanticKeywordInput(body);
    assertMutationContext(projectId, headers, input);
    const result = await this.keywords.update(
      internalUuid(keywordId, "keywordId"),
      input
    );
    return response(request, result);
  }

  @Delete(":keywordId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>
  ): Promise<void> {
    const input = internalDeleteSemanticKeywordInput(body);
    assertMutationContext(projectId, headers, input);
    await this.keywords.delete(internalUuid(keywordId, "keywordId"), input);
  }
}

const FREQUENCY_REGION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/u;

function internalFrequencyType(value: string): SemanticFrequencyType {
  if (!semanticFrequencyTypes.includes(value as SemanticFrequencyType)) {
    throw new BadRequestException("Frequency type is invalid");
  }
  return value as SemanticFrequencyType;
}

function internalFrequencyRegion(value: unknown): string {
  if (typeof value !== "string" || !FREQUENCY_REGION_PATTERN.test(value)) {
    throw new BadRequestException("Frequency region is invalid");
  }
  return value;
}

function internalFrequencyDevice(value: string): SemanticFrequencyDevice {
  if (!semanticFrequencyDevices.includes(value as SemanticFrequencyDevice)) {
    throw new BadRequestException("Frequency device is invalid");
  }
  return value as SemanticFrequencyDevice;
}

function assertMutationContext(
  projectId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  }
): void {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  assertInternalContext(context, input);
}

function response(
  request: FastifyRequest,
  data: SemanticKeywordListItem
): ApiResponse<SemanticKeywordListItem> {
  return {
    data,
    meta: { requestId: request.id, version: data.version }
  };
}
