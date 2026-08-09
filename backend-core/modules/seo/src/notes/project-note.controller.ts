import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ProjectNoteCollection,
  ProjectNoteSummary,
  PublicProjectNote
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid,
  type InternalCommandContext
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCreateProjectNoteInput,
  internalDeleteProjectNoteInput,
  internalUpdateProjectNoteInput,
  publicNoteToken
} from "./project-note-input.js";
import { ProjectNoteService } from "./project-note.service.js";

type InternalHeaders = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId/notes")
@UseGuards(PlatformApiGuard)
export class ProjectNoteController {
  public constructor(private readonly notes: ProjectNoteService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectNoteCollection>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.notes.list(context.workspaceId, context.projectId)
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectNoteSummary>> {
    const input = internalCreateProjectNoteInput(body);
    assertInternalContext(input, routeContext(projectId, headers));
    return response(request, await this.notes.create(input));
  }

  @Get(":noteId")
  public async get(
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectNoteSummary>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.notes.get(
        context.workspaceId,
        context.projectId,
        internalUuid(noteId, "noteId")
      )
    );
  }

  @Patch(":noteId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectNoteSummary>> {
    const input = internalUpdateProjectNoteInput(body);
    assertInternalContext(input, routeContext(projectId, headers));
    return response(
      request,
      await this.notes.update(internalUuid(noteId, "noteId"), input)
    );
  }

  @Delete(":noteId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async archive(
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders
  ): Promise<void> {
    const input = internalDeleteProjectNoteInput(body);
    assertInternalContext(input, routeContext(projectId, headers));
    await this.notes.archive(internalUuid(noteId, "noteId"), input);
  }
}

@Controller("internal/v1/public/project-notes")
@UseGuards(PlatformApiGuard)
export class PublicProjectNoteController {
  public constructor(private readonly notes: ProjectNoteService) {}

  @Get(":token")
  public async get(
    @Param("token") token: string,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<PublicProjectNote>> {
    return response(request, await this.notes.getPublic(publicNoteToken(token)));
  }
}

function routeContext(
  routeProjectId: string,
  headers: InternalHeaders
): InternalCommandContext {
  const context = internalCommandContext(headers);
  if (internalUuid(routeProjectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  return context;
}

function response<Data>(request: FastifyRequest, data: Data): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
