import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { InternalApiGuard } from "../internal/internal-api.guard.js";
import {
  completeUploadInput,
  createUploadPartUrlsInput,
  internalCreateUploadInput
} from "./upload-input.js";
import { UploadService } from "./upload.service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Controller("internal/v1/uploads")
@UseGuards(InternalApiGuard)
export class UploadController {
  public constructor(
    private readonly uploads: UploadService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Post()
  public async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CreatedMultipartUpload>> {
    return response(
      request,
      await this.uploads.create(
        internalCreateUploadInput(
          body,
          this.config.uploads.maxSizeBytes
        )
      )
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
  return {
    uploadId: uuid(uploadId, "uploadId"),
    workspaceId: uuid(header(headers, "x-workspace-id"), "workspaceId"),
    projectId: uuid(header(headers, "x-project-id"), "projectId"),
    actorId: uuid(header(headers, "x-actor-id"), "actorId")
  };
}

function header(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string
): string {
  const value = headers[name];
  if (typeof value !== "string") {
    throw new BadRequestException(`Missing trusted internal header: ${name}`);
  }
  return value;
}

function uuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(
      `Invalid trusted internal identifier: ${field}`
    );
  }
  return value;
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
