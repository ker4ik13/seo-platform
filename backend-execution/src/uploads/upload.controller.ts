import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  CreatedMultipartUpload,
  UploadPartUrls,
  UploadSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  completeUploadInput,
  createUploadPartUrlsInput,
  internalCreateUploadInput
} from "./upload-input.js";
import { UploadService } from "./upload.service.js";

@Controller("internal/v1/uploads")
@UseGuards(PlatformApiGuard)
export class UploadController {
  public constructor(
    private readonly uploads: UploadService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Post()
  public async create(
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CreatedMultipartUpload>> {
    const input = internalCreateUploadInput(
      body,
      this.config.uploads.maxSizeBytes
    );
    assertInternalContext(input, internalCommandContext(headers));
    return response(
      request,
      await this.uploads.create(input)
    );
  }

  @Post(":uploadId/parts")
  public async partUrls(
    @Param("uploadId") uploadId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<UploadPartUrls>> {
    const context = uploadContext(uploadId, headers);
    return response(
      request,
      await this.uploads.partUrls(
        context.uploadId,
        context.workspaceId,
        context.projectId,
        context.actorId,
        createUploadPartUrlsInput(body).partNumbers
      )
    );
  }

  @Post(":uploadId/complete")
  public async complete(
    @Param("uploadId") uploadId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<UploadSummary>> {
    const context = uploadContext(uploadId, headers);
    return response(
      request,
      await this.uploads.complete(
        context.uploadId,
        context.workspaceId,
        context.projectId,
        context.actorId,
        completeUploadInput(body),
        request.id
      )
    );
  }

  @Get(":uploadId")
  public async get(
    @Param("uploadId") uploadId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<UploadSummary>> {
    const context = uploadContext(uploadId, headers);
    return response(
      request,
      await this.uploads.get(
        context.uploadId,
        context.workspaceId,
        context.projectId
      )
    );
  }

  @Delete(":uploadId")
  public async abort(
    @Param("uploadId") uploadId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<UploadSummary>> {
    const context = uploadContext(uploadId, headers);
    return response(
      request,
      await this.uploads.abort(
        context.uploadId,
        context.workspaceId,
        context.projectId,
        context.actorId,
        request.id
      )
    );
  }
}

function uploadContext(
  uploadId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>
): {
  readonly uploadId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
} {
  const context = internalCommandContext(headers);
  return {
    uploadId: internalUuid(uploadId, "uploadId"),
    ...context
  };
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return {
    data,
    meta: { requestId: request.id }
  };
}
