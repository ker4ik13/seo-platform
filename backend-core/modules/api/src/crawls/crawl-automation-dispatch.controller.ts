import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalDispatchCrawlAutomationRunReceipt
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { AuthorizedProjectTenant } from "../authorization/project-tenant.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { assertUuid } from "../common/identifier.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { CrawlAutomationDispatchGuard } from "./crawl-automation-dispatch.guard.js";
import {
  crawlAutomationDispatchInput,
  requiredDispatchHeaders
} from "./crawl-automation-dispatch.input.js";

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/crawl-automation-runs"
)
@UseGuards(CrawlAutomationDispatchGuard)
export class CrawlAutomationDispatchController {
  private readonly logger = new Logger(
    CrawlAutomationDispatchController.name
  );

  public constructor(
    private readonly authorization: AuthorizationService,
    private readonly billing: BillingEntitlementService,
    private readonly jobs: JobsClient,
    private readonly audit: AuditService
  ) {}

  @Post("dispatch")
  @HttpCode(HttpStatus.CREATED)
  public async dispatch(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalDispatchCrawlAutomationRunReceipt>> {
    const input = crawlAutomationDispatchInput(body);
    const headers = requiredDispatchHeaders(request);
    if (
      assertUuid(workspaceId, "workspaceId") !== input.workspaceId ||
      assertUuid(projectId, "projectId") !== input.projectId ||
      headers.workspaceId !== input.workspaceId ||
      headers.projectId !== input.projectId ||
      headers.actorId !== input.actorId ||
      headers.idempotencyKey !== input.idempotencyKey ||
      headers.requestId !== request.id
    ) {
      throw new BadRequestException(
        "Route, trusted headers and crawl automation command do not match"
      );
    }
    const authorization = await this.authorization.forProject(
      input.actorId,
      input.projectId,
      "page.manage"
    );
    if (
      authorization.workspaceId !== input.workspaceId ||
      authorization.projectId !== input.projectId ||
      authorization.workspaceStatus !== "ACTIVE" ||
      authorization.projectStatus === "ARCHIVED"
    ) {
      throw new BadRequestException(
        "Crawl automation execution scope is no longer active"
      );
    }
    const tenant = authorization as AuthorizedProjectTenant;
    // A schedule may outlive the subscription that originally enabled it.
    // Re-check billing immediately before every paid crawl dispatch.
    await this.billing.automationCapacity(input.workspaceId);
    await this.audit.record({
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: "crawl.automation.run_requested",
      resourceType: "crawl_automation_run",
      resourceId: input.runId,
      outcome: "REQUESTED",
      requestId: request.id
    });
    const crawl = await this.jobs.createTechnicalCrawl(
      {
        tenant,
        actorId: input.actorId,
        requestId: request.id
      },
      input.config,
      input.idempotencyKey,
      await this.billing.jobCapacity(input.workspaceId)
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: "crawl.automation.run_dispatched",
      resourceType: "crawl_automation_run",
      resourceId: input.runId,
      outcome: "SUCCESS",
      requestId: request.id
    });
    return {
      data: { crawl },
      meta: { requestId: request.id }
    };
  }
}
