import { Body, Controller, Post, Req, UseGuards, BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { parsePageStatusInput, pageStatusRecord, pageStatusId } from "@seo-platform/contracts";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { PageService } from "./page.service.js";
@Controller("internal/v1/page-status")
@UseGuards(JobsApiGuard)
export class PageStatusController {
  public constructor(private readonly pages: PageService) {}
  private input(body: unknown) {
    try { const row = pageStatusRecord(body, ["workspaceId", "projectId", "actorId", "input"]); return { workspaceId: pageStatusId(row.workspaceId), projectId: pageStatusId(row.projectId), actorId: pageStatusId(row.actorId), input: parsePageStatusInput(row.input) }; }
    catch { throw new BadRequestException("Invalid page status input"); }
  }
  @Post("prepare")
  public async prepare(@Body() body: unknown, @Req() request: FastifyRequest) { return { data: await this.pages.prepareStatus(this.input(body)), meta: { requestId: request.id } }; }
  @Post("apply")
  public async apply(@Body() body: unknown, @Req() request: FastifyRequest) { return { data: await this.pages.applyStatus(this.input(body)), meta: { requestId: request.id } }; }
}
