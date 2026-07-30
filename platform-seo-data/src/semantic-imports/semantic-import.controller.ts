import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalNormalizeSemanticKeywordsResult,
  InternalSemanticImportChunkResult,
  InternalSemanticImportReceipt,
  SemanticImportResultSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import {
  applySemanticImportChunkInput,
  beginSemanticImportInput,
  completeSemanticImportInput,
  normalizeSemanticKeywordsInput
} from "./semantic-import-input.js";
import { SemanticImportService } from "./semantic-import.service.js";

@Controller("internal/v1/semantic-imports/:importId")
@UseGuards(JobsApiGuard)
export class SemanticImportController {
  public constructor(
    private readonly semanticImports: SemanticImportService
  ) {}

  @Post("normalize")
  public async normalize(
    @Param("importId") importId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalNormalizeSemanticKeywordsResult>> {
    const input = normalizeSemanticKeywordsInput(body);
    assertCommand(importId, headers, input);
    return response(
      request,
      await this.semanticImports.normalizeKeywords(input)
    );
  }

  @Post("begin")
  public async begin(
    @Param("importId") importId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalSemanticImportReceipt>> {
    const input = beginSemanticImportInput(body);
    assertCommand(importId, headers, input);
    return response(request, await this.semanticImports.begin(input));
  }

  @Post("chunks")
  public async applyChunk(
    @Param("importId") importId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalSemanticImportChunkResult>> {
    const input = applySemanticImportChunkInput(body);
    assertCommand(importId, headers, input);
    return response(request, await this.semanticImports.applyChunk(input));
  }

  @Post("complete")
  public async complete(
    @Param("importId") importId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticImportResultSummary>> {
    const input = completeSemanticImportInput(body);
    assertCommand(importId, headers, input);
    return response(request, await this.semanticImports.complete(input));
  }
}

function assertCommand(
  routeImportId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  input: {
    readonly importId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  }
): void {
  if (internalUuid(routeImportId, "importId") !== input.importId) {
    throw new BadRequestException(
      "Route import identifier does not match the command"
    );
  }
  assertInternalContext(input, internalCommandContext(headers));
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
