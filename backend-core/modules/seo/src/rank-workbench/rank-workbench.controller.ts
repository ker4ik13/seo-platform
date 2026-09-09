import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  parseDeleteRankDimensionHistoryInput,
  parseRankPositionReportInput,
  parseSerpWorkbenchInput
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { internalCommandContext, internalUuid } from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { RankWorkbenchService } from "./rank-workbench.service.js";

@Controller("internal/v1/projects/:projectId/rank-workbench")
@UseGuards(PlatformApiGuard)
export class RankWorkbenchController {
  public constructor(private readonly workbench: RankWorkbenchService) {}

  @Post("positions")
  @HttpCode(200)
  public async positions(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ) {
    const context = scope(projectId, headers);
    return {
      data: await this.workbench.positions(
        context,
        parseBody(parseRankPositionReportInput, body)
      ),
      meta: { requestId: request.id }
    };
  }

  @Post("serp")
  @HttpCode(200)
  public async serp(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ) {
    const context = scope(projectId, headers);
    return {
      data: await this.workbench.serp(
        context,
        parseBody(parseSerpWorkbenchInput, body)
      ),
      meta: { requestId: request.id }
    };
  }

  @Post("delete-dimension-history")
  @HttpCode(200)
  public async deleteDimensionHistory(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ) {
    const context = scope(projectId, headers);
    const idempotencyKey = singleHeader(headers["idempotency-key"]);
    return {
      data: await this.workbench.deleteDimensionHistory(
        context,
        parseBody(parseDeleteRankDimensionHistoryInput, body),
        idempotencyKey
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

function parseBody<Input>(
  parser: (value: unknown) => Input,
  value: unknown
): Input {
  try {
    return parser(value);
  } catch {
    throw new BadRequestException("Invalid rank workbench input");
  }
}

function singleHeader(value: string | string[] | undefined): string {
  if (typeof value !== "string") {
    throw new BadRequestException("Idempotency-Key is required");
  }
  return value;
}
