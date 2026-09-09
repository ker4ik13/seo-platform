import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  parseCreateRankDimensionMergeInput,
  parseSemanticRankComparisonInput
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { internalCommandContext, internalUuid } from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { KeywordRankComparisonService } from "./keyword-rank-comparison.service.js";

@Controller("internal/v1/projects/:projectId/keyword-ranks")
@UseGuards(PlatformApiGuard)
export class KeywordRankComparisonController {
  public constructor(private readonly ranks: KeywordRankComparisonService) {}

  @Get("dimensions")
  public async catalog(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ) {
    return {
      data: await this.ranks.catalog(scope(projectId, headers)),
      meta: { requestId: request.id }
    };
  }

  @Get("dimension-merges")
  public async mergeSettings(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ) {
    return {
      data: await this.ranks.mergeSettings(scope(projectId, headers)),
      meta: { requestId: request.id }
    };
  }

  @Post("dimension-merges")
  public async createMerge(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ) {
    const context = scope(projectId, headers);
    return {
      data: await this.ranks.createMerge(
        context,
        parseBody(parseCreateRankDimensionMergeInput, body),
        singleHeader(headers["idempotency-key"])
      ),
      meta: { requestId: request.id }
    };
  }

  @Post("dimension-merges/:mergeId/remove")
  @HttpCode(200)
  public async removeMerge(
    @Param("projectId") projectId: string,
    @Param("mergeId") mergeId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ) {
    const input = bodyRecord(body);
    if (
      Object.keys(input).some((key) => key !== "version") ||
      !Number.isSafeInteger(input.version) ||
      Number(input.version) < 1
    ) {
      throw new BadRequestException("Invalid rank dimension merge version");
    }
    return {
      data: await this.ranks.removeMerge(
        scope(projectId, headers),
        internalUuid(mergeId, "mergeId"),
        Number(input.version)
      ),
      meta: { requestId: request.id }
    };
  }

  @Post("comparison")
  @HttpCode(200)
  public async compare(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ) {
    const context = scope(projectId, headers);
    return {
      data: await this.ranks.compare(
        context,
        parseBody(parseSemanticRankComparisonInput, body)
      ),
      meta: { requestId: request.id }
    };
  }
}

function scope(
  projectId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>
) {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) {
    throw new BadRequestException("Route project does not match trusted context");
  }
  return context;
}

function parseBody<Input>(parser: (value: unknown) => Input, value: unknown): Input {
  try {
    return parser(value);
  } catch {
    throw new BadRequestException("Invalid rank comparison input");
  }
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid rank dimension merge input");
  }
  return value as Record<string, unknown>;
}

function singleHeader(value: string | string[] | undefined): string {
  if (typeof value !== "string") {
    throw new BadRequestException("Idempotency-Key is required");
  }
  return value;
}
