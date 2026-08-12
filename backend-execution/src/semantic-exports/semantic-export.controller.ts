import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticExportCollection,
  SemanticExportDownload,
  SemanticExportJobSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCancelSemanticExportInput,
  internalCreateSemanticExportInput
} from "./semantic-export-input.js";
import { SemanticExportService } from "./semantic-export.service.js";

@Controller("internal/v1/semantic-exports")
@UseGuards(PlatformApiGuard)
export class SemanticExportController {
  public constructor(private readonly exports: SemanticExportService) {}

  @Post()
  public async create(
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticExportJobSummary>> {
    const input = internalCreateSemanticExportInput(body);
    assertInternalContext(input, internalCommandContext(headers));
    return response(request, await this.exports.create(input));
  }

  @Get()
  public async list(
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticExportCollection>> {
    const context = internalCommandContext(headers);
    return response(
      request,
      await this.exports.list(context.workspaceId, context.projectId)
    );
  }

  @Get(":exportId")
  public async get(
    @Param("exportId") exportId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticExportJobSummary>> {
    const context = internalCommandContext(headers);
    return response(
      request,
      await this.exports.get(
        context.workspaceId,
        context.projectId,
        internalUuid(exportId, "exportId")
      )
    );
  }

  @Get(":exportId/download")
  public async download(
    @Param("exportId") exportId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticExportDownload>> {
    const context = internalCommandContext(headers);
    return response(
      request,
      await this.exports.download(
        context.workspaceId,
        context.projectId,
        internalUuid(exportId, "exportId")
      )
    );
  }

  @Post(":exportId/cancel")
  public async cancel(
    @Param("exportId") exportId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticExportJobSummary>> {
    const input = internalCancelSemanticExportInput(body);
    assertInternalContext(input, internalCommandContext(headers));
    return response(
      request,
      await this.exports.cancel(internalUuid(exportId, "exportId"), input)
    );
  }
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
