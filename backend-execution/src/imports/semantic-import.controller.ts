import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticImportPreviewRowsPage,
  SemanticImportSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCancelSemanticImportInput,
  internalConfigureSemanticImportInput,
  internalConfirmSemanticImportInput,
  internalCreateSemanticImportInput,
  semanticImportPreviewRowsQuery
} from "./semantic-import-input.js";
import { SemanticImportService } from "./semantic-import.service.js";

@Controller("internal/v1/imports")
@UseGuards(PlatformApiGuard)
export class SemanticImportController {
  public constructor(
    private readonly semanticImports: SemanticImportService
  ) {}

  @Post()
  public async create(
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticImportSummary>> {
    const input = internalCreateSemanticImportInput(body);
    assertInternalContext(input, internalCommandContext(headers));
    return response(
      request,
      await this.semanticImports.create(input, request.id)
    );
  }

  @Get(":importId")
  public async get(
    @Param("importId") importId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticImportSummary>> {
    const context = internalCommandContext(headers);
    return response(
      request,
      await this.semanticImports.get(
        internalUuid(importId, "importId"),
        context.workspaceId,
        context.projectId
      )
    );
  }

  @Get(":importId/preview-rows")
  public async previewRows(
    @Param("importId") importId: string,
    @Query("cursor") cursor: unknown,
    @Query("sortColumn") sortColumn: unknown,
    @Query("sortDirection") sortDirection: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticImportPreviewRowsPage>> {
    const context = internalCommandContext(headers);
    return response(
      request,
      await this.semanticImports.previewRows(
        internalUuid(importId, "importId"),
        context.workspaceId,
        context.projectId,
        semanticImportPreviewRowsQuery(cursor, sortColumn, sortDirection)
      )
    );
  }

  @Post(":importId/mapping")
  public async configure(
    @Param("importId") importId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticImportSummary>> {
    const input = internalConfigureSemanticImportInput(body);
    assertInternalContext(input, internalCommandContext(headers));
    return response(
      request,
      await this.semanticImports.configure(
        internalUuid(importId, "importId"),
        input
      )
    );
  }

  @Post(":importId/publish")
  public async publish(
    @Param("importId") importId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticImportSummary>> {
    const input = internalConfirmSemanticImportInput(body);
    assertInternalContext(input, internalCommandContext(headers));
    return response(
      request,
      await this.semanticImports.confirm(
        internalUuid(importId, "importId"),
        input
      )
    );
  }

  @Post(":importId/cancel")
  public async cancel(
    @Param("importId") importId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticImportSummary>> {
    const input = internalCancelSemanticImportInput(body);
    assertInternalContext(input, internalCommandContext(headers));
    return response(
      request,
      await this.semanticImports.cancel(
        internalUuid(importId, "importId"),
        input,
        request.id
      )
    );
  }
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
