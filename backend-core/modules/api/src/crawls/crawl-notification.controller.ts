import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalCreateProjectNotificationInput,
  InternalDeliverCrawlNotificationReceipt
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { AuthorizedProjectTenant } from "../authorization/project-tenant.js";
import { assertUuid } from "../common/identifier.js";
import { RealtimeClient } from "../realtime/realtime.client.js";
import { CrawlAutomationDispatchGuard } from "./crawl-automation-dispatch.guard.js";
import { requiredDispatchHeaders } from "./crawl-automation-dispatch.input.js";
import { crawlNotificationInput } from "./crawl-notification.input.js";

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/crawls/:crawlId"
)
@UseGuards(CrawlAutomationDispatchGuard)
export class CrawlNotificationController {
  public constructor(
    private readonly authorization: AuthorizationService,
    private readonly realtime: RealtimeClient
  ) {}

  @Post("notification")
  @HttpCode(HttpStatus.OK)
  public async deliver(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("crawlId") crawlId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalDeliverCrawlNotificationReceipt>> {
    const input = crawlNotificationInput(body);
    const headers = requiredDispatchHeaders(request);
    if (
      assertUuid(workspaceId, "workspaceId") !== input.workspaceId ||
      assertUuid(projectId, "projectId") !== input.projectId ||
      assertUuid(crawlId, "crawlId") !== input.crawlId ||
      headers.workspaceId !== input.workspaceId ||
      headers.projectId !== input.projectId ||
      headers.actorId !== input.actorId ||
      headers.idempotencyKey !== input.idempotencyKey ||
      headers.requestId !== request.id
    ) {
      throw new BadRequestException(
        "Route, trusted headers and crawl notification do not match"
      );
    }
    const authorization = await this.authorization.forProject(
      input.actorId,
      input.projectId,
      "page.view"
    );
    if (
      authorization.workspaceId !== input.workspaceId ||
      authorization.projectId !== input.projectId ||
      authorization.workspaceStatus !== "ACTIVE" ||
      authorization.projectStatus === "ARCHIVED"
    ) {
      throw new BadRequestException(
        "Crawl notification scope is no longer active"
      );
    }
    const tenant = authorization as AuthorizedProjectTenant;
    const content = notificationContent(input);
    const command: InternalCreateProjectNotificationInput = {
      userId: input.actorId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      membershipId: tenant.membershipId!,
      membershipVersion: tenant.membershipVersion!,
      eventType: "CRAWL_RADAR",
      severity: content.severity,
      title: content.title,
      body: content.body,
      actorId: input.actorId,
      resource: { type: "technical_crawl", id: input.crawlId },
      deepLink: `/app/tasks/crawl/${input.crawlId}`,
      dedupeKey: `crawl:${input.crawlId}:${input.status}`,
      ownJob: true
    };
    const result = await this.realtime.createProjectNotification(
      {
        actorId: input.actorId,
        requestId: request.id,
        tenant
      },
      command
    );
    return {
      data: { accepted: true, outcome: result.outcome },
      meta: { requestId: request.id }
    };
  }
}

function notificationContent(
  input: ReturnType<typeof crawlNotificationInput>
): {
  readonly severity: "INFO" | "WARNING" | "CRITICAL";
  readonly title: string;
  readonly body: string;
} {
  if (input.purpose === "HTTP_STATUS_CHECK") {
    return httpStatusNotificationContent(input);
  }
  if (input.status === "FAILED") {
    return {
      severity: "CRITICAL",
      title: "Аудит сайта завершился ошибкой",
      body: `Обработано страниц: ${input.processedUrls}. Запустите аудит повторно или проверьте настройки сайта.`
    };
  }
  if (input.status === "CANCELLED") {
    return {
      severity: "INFO",
      title: "Аудит сайта отменён",
      body: `До отмены обработано страниц: ${input.processedUrls}.`
    };
  }
  if (input.status === "PARTIALLY_COMPLETED") {
    return {
      severity: "WARNING",
      title: "Аудит сайта завершён частично",
      body: `Обработано страниц: ${input.processedUrls}, найдено проблем: ${input.issueCount}.`
    };
  }
  return {
    severity: input.issueCount > 0 ? "WARNING" : "INFO",
    title:
      input.issueCount > 0
        ? "Аудит сайта завершён с замечаниями"
        : "Аудит сайта завершён",
    body:
      input.issueCount > 0
        ? `Обработано страниц: ${input.processedUrls}, найдено проблем: ${input.issueCount}.`
        : `Обработано страниц: ${input.processedUrls}, проблем не обнаружено.`
  };
}

function httpStatusNotificationContent(
  input: ReturnType<typeof crawlNotificationInput>
): {
  readonly severity: "INFO" | "WARNING" | "CRITICAL";
  readonly title: string;
  readonly body: string;
} {
  if (input.status === "FAILED") {
    return {
      severity: "CRITICAL",
      title: "Проверка HTTP-статусов завершилась ошибкой",
      body: `Обработано страниц: ${input.processedUrls}. Проверьте доступность сайта и параметры запуска.`
    };
  }
  if (input.status === "CANCELLED") {
    return {
      severity: "INFO",
      title: "Проверка HTTP-статусов отменена",
      body: `До отмены обработано страниц: ${input.processedUrls}.`
    };
  }
  if (input.status === "PARTIALLY_COMPLETED") {
    return {
      severity: "WARNING",
      title: "Проверка HTTP-статусов завершена частично",
      body: `Обработано страниц: ${input.processedUrls}. Откройте результат, чтобы проверить ответы и редиректы.`
    };
  }
  return {
    severity: "INFO",
    title: "Проверка HTTP-статусов завершена",
    body: `Обработано страниц: ${input.processedUrls}. Ответы и цепочки редиректов готовы.`
  };
}
