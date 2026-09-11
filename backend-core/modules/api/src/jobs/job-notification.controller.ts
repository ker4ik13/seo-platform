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
  InternalDeliverJobNotificationInput,
  InternalDeliverJobNotificationReceipt,
  ProjectNotificationEventType
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { AuthorizedProjectTenant } from "../authorization/project-tenant.js";
import { assertUuid } from "../common/identifier.js";
import { CrawlAutomationDispatchGuard } from "../crawls/crawl-automation-dispatch.guard.js";
import { requiredDispatchHeaders } from "../crawls/crawl-automation-dispatch.input.js";
import { RealtimeClient } from "../realtime/realtime.client.js";
import { jobNotificationInput } from "./job-notification.input.js";

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/jobs/:jobId"
)
@UseGuards(CrawlAutomationDispatchGuard)
export class JobNotificationController {
  public constructor(
    private readonly authorization: AuthorizationService,
    private readonly realtime: RealtimeClient
  ) {}

  @Post("notification")
  @HttpCode(HttpStatus.OK)
  public async deliver(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalDeliverJobNotificationReceipt>> {
    const input = jobNotificationInput(body);
    const headers = requiredDispatchHeaders(request);
    if (
      assertUuid(workspaceId, "workspaceId") !== input.workspaceId ||
      assertUuid(projectId, "projectId") !== input.projectId ||
      assertUuid(jobId, "jobId") !== input.jobId ||
      headers.workspaceId !== input.workspaceId ||
      headers.projectId !== input.projectId ||
      headers.actorId !== input.actorId ||
      headers.idempotencyKey !== input.idempotencyKey ||
      headers.requestId !== request.id
    ) {
      throw new BadRequestException(
        "Route, trusted headers and job notification do not match"
      );
    }
    const authorization = await this.authorization.forProject(
      input.actorId,
      input.projectId,
      "project.view"
    );
    if (
      authorization.workspaceId !== input.workspaceId ||
      authorization.projectId !== input.projectId ||
      authorization.workspaceStatus !== "ACTIVE" ||
      authorization.projectStatus === "ARCHIVED"
    ) {
      throw new BadRequestException(
        "Job notification scope is no longer active"
      );
    }
    const tenant = authorization as AuthorizedProjectTenant;
    const content = jobNotificationContent(input);
    const command: InternalCreateProjectNotificationInput = {
      userId: input.actorId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      membershipId: tenant.membershipId!,
      membershipVersion: tenant.membershipVersion!,
      eventType: content.eventType,
      severity: content.severity,
      title: content.title,
      body: content.body,
      actorId: input.actorId,
      resource: { type: "job", id: input.jobId },
      deepLink: content.deepLink,
      dedupeKey: input.idempotencyKey,
      ownJob: true
    };
    const result = await this.realtime.createProjectNotification(
      { actorId: input.actorId, requestId: request.id, tenant },
      command
    );
    return {
      data: { accepted: true, outcome: result.outcome },
      meta: { requestId: request.id }
    };
  }
}

export function jobNotificationContent(
  input: InternalDeliverJobNotificationInput
): {
  readonly eventType: ProjectNotificationEventType;
  readonly severity: "INFO" | "WARNING" | "CRITICAL";
  readonly title: string;
  readonly body: string;
  readonly deepLink: string;
} {
  const operation = operationDescriptor(input.jobType, input.jobId);
  const progress = input.progressTotal === null
    ? `Обработано: ${input.progressCurrent}.`
    : `Обработано: ${input.progressCurrent} из ${input.progressTotal}.`;
  if (input.status === "FAILED_FINAL") {
    return {
      ...operation,
      severity: "CRITICAL",
      title: `${operation.label}: ошибка`,
      body: `${progress}${input.errorCode ? ` Код: ${input.errorCode}.` : ""}`
    };
  }
  if (input.status === "ACTION_REQUIRED") {
    return {
      ...operation,
      severity: "WARNING",
      title: `${operation.label}: требуется внимание`,
      body: `${progress}${input.errorCode ? ` Код: ${input.errorCode}.` : " Проверьте параметры операции."}`
    };
  }
  if (input.status === "PARTIALLY_COMPLETED") {
    return {
      ...operation,
      severity: "WARNING",
      title: `${operation.label}: завершено частично`,
      body: progress
    };
  }
  if (input.status === "CANCELLED") {
    return {
      ...operation,
      severity: "INFO",
      title: `${operation.label}: отменено`,
      body: progress
    };
  }
  return {
    ...operation,
    severity: "INFO",
    title: `${operation.label}: завершено`,
    body: progress
  };
}

function operationDescriptor(jobType: string, jobId: string): {
  readonly eventType: ProjectNotificationEventType;
  readonly label: string;
  readonly deepLink: string;
} {
  if (
    jobType === "FREQUENCY_COLLECTION" ||
    jobType === "WORDSTAT_FREQUENCY_COLLECTION"
  ) {
    return {
      eventType: "FREQUENCY_COLLECTION",
      label: "Сбор частотности",
      deepLink: `/app/tasks/frequency/${jobId}`
    };
  }
  if (jobType === "WORDSTAT_SEASONALITY_COLLECTION") {
    return {
      eventType: "FREQUENCY_COLLECTION",
      label: "Сбор сезонности",
      deepLink: `/app/tasks/frequency/${jobId}`
    };
  }
  if (
    jobType === "MANUAL_RANK_CHECK" ||
    jobType === "RANK_POSITION_TRACKING"
  ) {
    return {
      eventType: "RANK_TRACKING",
      label: "Проверка позиций",
      deepLink: `/app/tasks/rank/${jobId}`
    };
  }
  if (jobType === "RANK_COMPETITOR_SERP") {
    return {
      eventType: "SERP_COLLECTION",
      label: "Выдача конкурентов",
      deepLink: `/app/tasks/rank/${jobId}`
    };
  }
  if (jobType === "AI_ANSWER_COLLECTION") {
    return {
      eventType: "SERP_COLLECTION",
      label: "Сбор ИИ-ответов",
      deepLink: `/app/tasks/ai-answer/${jobId}`
    };
  }
  if (jobType === "AI_COMPETITOR_SERP") {
    return {
      eventType: "SERP_COLLECTION",
      label: "ИИ-выдача конкурентов",
      deepLink: `/app/tasks/ai-answer/${jobId}`
    };
  }
  if (jobType === "CLUSTERING_RUN") {
    return {
      eventType: "CLUSTERING",
      label: "Кластеризация запросов",
      deepLink: `/app/tasks/clustering/${jobId}`
    };
  }
  if (jobType === "KEYS_SO_RESEARCH") {
    return {
      eventType: "MAGNET",
      label: "Анализ Keys.so",
      deepLink: `/app/tasks/research/${jobId}`
    };
  }
  if (
    jobType === "KEYWORD_RESEARCH" ||
    jobType === "WORDSTAT_KEYWORD_RESEARCH"
  ) {
    return {
      eventType: "MAGNET",
      label: jobType === "KEYWORD_RESEARCH"
        ? "Исследование запросов"
        : "Парсинг Wordstat",
      deepLink: `/app/tasks/research/${jobId}`
    };
  }
  if (jobType === "SEMANTIC_IMPORT") {
    return {
      eventType: "SEMANTIC_IMPORT",
      label: "Импорт семантики",
      deepLink: "/app/tasks"
    };
  }
  if (jobType === "SEMANTIC_EXPORT") {
    return {
      eventType: "REPORT",
      label: "Экспорт семантики",
      deepLink: "/app/tasks"
    };
  }
  return {
    eventType: "JOB",
    label: "Операция",
    deepLink: "/app/tasks"
  };
}
