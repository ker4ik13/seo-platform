import { jobCapacityInput } from "../jobs/job-capacity-input.js";
import { Body, Controller, Get, Post, Headers, Param, Req, UseGuards, BadRequestException } from "@nestjs/common";
import { parsePageStatusInput, pageStatusRecord } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { internalCommandContext, internalUuid } from "../internal/internal-command-context.js";
import { PageStatusService } from "./page-status.service.js";
@Controller("internal/v1/page-status-jobs")
@UseGuards(PlatformApiGuard)
export class PageStatusController {
  public constructor(private readonly service: PageStatusService) {}
  @Post()
  public async create(@Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>, @Req() request: FastifyRequest) {
    try {
      const row = pageStatusRecord(body, ["input", "idempotencyKey", "correlationId", "jobCapacity"]), context = internalCommandContext(headers);
      if (typeof row.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,180}$/u.test(row.idempotencyKey) || typeof row.correlationId !== "string" || row.correlationId.length < 1 || row.correlationId.length > 100) throw new TypeError();
      return { data: await this.service.create({ ...context, idempotencyKey: row.idempotencyKey, correlationId: row.correlationId, jobCapacity: jobCapacityInput(row.jobCapacity) }, parsePageStatusInput(row.input)), meta: { requestId: request.id } };
    } catch (error) { if (error instanceof TypeError) throw new BadRequestException("Invalid page status command"); throw error; }
  }
  @Get(":id")
  public async get(@Param("id") id: string, @Headers() headers: Record<string, string | string[] | undefined>, @Req() request: FastifyRequest) {
    const scope = internalCommandContext(headers);
    return { data: await this.service.get(scope.workspaceId, scope.projectId, internalUuid(id, "jobId")), meta: { requestId: request.id } };
  }
}
