import {
  BadRequestException,
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
  InternalPersistCrawlPageReceipt,
  ProjectCrawlPageChangeCollection,
  ProjectCrawlIssueCollection
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalFinalizeCrawlSnapshotInput,
  internalPersistCrawlPageInput
} from "./crawl-input.js";
import { CrawlSnapshotService } from "./crawl-snapshot.service.js";

@Controller("internal/v1/crawl-snapshots")
@UseGuards(JobsApiGuard)
export class CrawlSnapshotController {
  public constructor(private readonly snapshots: CrawlSnapshotService) {}

  @Post("pages")
  public async persist(
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalPersistCrawlPageReceipt>> {
    return response(
      request,
      await this.snapshots.persistPage(internalPersistCrawlPageInput(body))
    );
  }

  @Post("finalize")
  public async finalize(
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly accepted: true }>> {
    return response(
      request,
      await this.snapshots.finalize(
        internalFinalizeCrawlSnapshotInput(body)
      )
    );
  }
}

@Controller("internal/v1/projects/:projectId/crawl-issues")
@UseGuards(PlatformApiGuard)
export class CrawlIssueController {
  public constructor(private readonly snapshots: CrawlSnapshotService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectCrawlIssueCollection>> {
    const context = internalCommandContext(headers);
    if (context.projectId !== internalUuid(projectId, "projectId")) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    return response(
      request,
      await this.snapshots.listIssues(
        context.workspaceId,
        context.projectId
      )
    );
  }
}

@Controller("internal/v1/projects/:projectId/crawl-changes")
@UseGuards(PlatformApiGuard)
export class CrawlPageChangeController {
  public constructor(private readonly snapshots: CrawlSnapshotService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectCrawlPageChangeCollection>> {
    const context = internalCommandContext(headers);
    if (context.projectId !== internalUuid(projectId, "projectId")) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    return response(
      request,
      await this.snapshots.listChanges(
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
