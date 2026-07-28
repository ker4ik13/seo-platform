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
  SemanticImportSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { InternalApiGuard } from "../internal/internal-api.guard.js";
import { internalCreateSemanticImportInput } from "./semantic-import-input.js";
import { SemanticImportService } from "./semantic-import.service.js";

@Controller("internal/v1/imports")
@UseGuards(InternalApiGuard)
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
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
