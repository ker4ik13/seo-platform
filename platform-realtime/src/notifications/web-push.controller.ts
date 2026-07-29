import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  WebPushDeviceSummary,
  WebPushRevokeResult,
  WebPushSubscriptionsState
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  internalActorContext,
  internalUuid,
  internalWebPushContext
} from "../internal/internal-context.js";
import { WebPushApiGuard } from "./web-push-api.guard.js";
import {
  webPushRenameInput,
  webPushUpsertInput
} from "./web-push-input.js";
import { WebPushService } from "./web-push.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/users/:userId/push-subscriptions")
@UseGuards(WebPushApiGuard)
export class WebPushController {
  public constructor(
    private readonly webPush: WebPushService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Get()
  public async list(
    @Param("userId") userId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WebPushSubscriptionsState>> {
    const actor = internalActorContext(headers);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    return response(request, await this.webPush.list(actor.actorId));
  }

  @Put(":installationId")
  public async upsert(
    @Param("userId") userId: string,
    @Param("installationId") installationId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WebPushDeviceSummary>> {
    const context = internalWebPushContext(headers);
    const input = webPushUpsertInput(body, this.config);
    assertSame(internalUuid(userId, "userId"), context.actorId, "user");
    assertSame(input.userId, context.actorId, "actor");
    assertSame(
      input.sessionFamilyId,
      context.sessionFamilyId,
      "session family"
    );
    const result = await this.webPush.upsert(
      internalUuid(installationId, "installationId"),
      input
    );
    return response(request, result, result.version);
  }

  @Patch(":installationId")
  public async rename(
    @Param("userId") userId: string,
    @Param("installationId") installationId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WebPushDeviceSummary>> {
    const actor = internalActorContext(headers);
    const input = webPushRenameInput(body);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    assertSame(input.userId, actor.actorId, "actor");
    const result = await this.webPush.rename(
      internalUuid(installationId, "installationId"),
      input
    );
    return response(request, result, result.version);
  }

  @Delete(":installationId")
  public async revoke(
    @Param("userId") userId: string,
    @Param("installationId") installationId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<WebPushRevokeResult>> {
    const actor = internalActorContext(headers);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    return response(
      request,
      await this.webPush.revoke(
        actor.actorId,
        internalUuid(installationId, "installationId")
      )
    );
  }
}

function response<Data>(
  request: FastifyRequest,
  data: Data,
  version?: number
): ApiResponse<Data> {
  return {
    data,
    meta: {
      requestId: request.id,
      ...(version === undefined ? {} : { version })
    }
  };
}

function assertSame(
  actual: string,
  expected: string,
  field: string
): void {
  if (actual !== expected) {
    throw new BadRequestException(
      `Trusted ${field} context does not match the command`
    );
  }
}
