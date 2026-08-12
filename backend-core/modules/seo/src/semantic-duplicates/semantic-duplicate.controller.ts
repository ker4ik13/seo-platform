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
  SemanticDuplicateApplyResult,
  SemanticDuplicatePreview
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalApplySemanticDuplicatesInput,
  internalSemanticDuplicateCommandInput
} from "./semantic-duplicate-input.js";
import { SemanticDuplicateService } from "./semantic-duplicate.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/semantic-duplicates")
@UseGuards(PlatformApiGuard)
export class SemanticDuplicateController {
  public constructor(
    private readonly semanticDuplicates: SemanticDuplicateService
  ) {}

  @Post("preview")
  public async preview(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticDuplicatePreview>> {
    const input = internalSemanticDuplicateCommandInput(body);
    assertMutation(projectId, headers, input);
    return {
      data: await this.semanticDuplicates.preview(input),
      meta: { requestId: request.id }
    };
  }

  @Post("apply")
  public async apply(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticDuplicateApplyResult>> {
    const input = internalApplySemanticDuplicatesInput(body);
    assertMutation(projectId, headers, input);
    return {
      data: await this.semanticDuplicates.apply(input),
      meta: { requestId: request.id }
    };
  }
}

function assertMutation(
  projectId: string,
  headers: InternalHeaders,
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
