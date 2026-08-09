import { randomBytes } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalCreateProjectNoteInput,
  InternalDeleteProjectNoteInput,
  InternalUpdateProjectNoteInput,
  ProjectNoteCollection,
  ProjectNoteSummary,
  PublicProjectNote
} from "@seo-platform/contracts";
import type { ProjectNote } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class ProjectNoteService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<ProjectNoteCollection> {
    const notes = await this.prisma.projectNote.findMany({
      where: { workspaceId, projectId, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
    return { notes: notes.map(summary) };
  }

  public async get(
    workspaceId: string,
    projectId: string,
    noteId: string
  ): Promise<ProjectNoteSummary> {
    return summary(await this.required(workspaceId, projectId, noteId));
  }

  public async create(
    input: InternalCreateProjectNoteInput
  ): Promise<ProjectNoteSummary> {
    return summary(
      await this.prisma.projectNote.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          title: input.title,
          markdown: input.markdown,
          visibility: input.visibility,
          ...(input.visibility === "PUBLIC"
            ? { publicToken: createPublicToken() }
            : {}),
          createdBy: input.actorId,
          updatedBy: input.actorId
        }
      })
    );
  }

  public async update(
    noteId: string,
    input: InternalUpdateProjectNoteInput
  ): Promise<ProjectNoteSummary> {
    const current = await this.required(
      input.workspaceId,
      input.projectId,
      noteId
    );
    const visibilityData =
      input.visibility === undefined
        ? {}
        : input.visibility === "PUBLIC"
          ? {
              visibility: "PUBLIC" as const,
              publicToken:
                current.visibility === "PUBLIC" && current.publicToken
                  ? current.publicToken
                  : createPublicToken()
            }
          : {
              visibility: "PROJECT_MEMBERS" as const,
              publicToken: null
            };
    const changed = await this.prisma.projectNote.updateMany({
      where: {
        id: noteId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        archivedAt: null,
        version: input.version
      },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.markdown === undefined
          ? {}
          : { markdown: input.markdown }),
        ...visibilityData,
        updatedBy: input.actorId,
        version: { increment: 1 }
      }
    });
    if (changed.count !== 1) throw new ConflictException("Version conflict");
    return this.get(input.workspaceId, input.projectId, noteId);
  }

  public async archive(
    noteId: string,
    input: InternalDeleteProjectNoteInput
  ): Promise<void> {
    const changed = await this.prisma.projectNote.updateMany({
      where: {
        id: noteId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        archivedAt: null,
        version: input.version
      },
      data: {
        archivedAt: new Date(),
        publicToken: null,
        updatedBy: input.actorId,
        version: { increment: 1 }
      }
    });
    if (changed.count !== 1) {
      const exists = await this.prisma.projectNote.findFirst({
        where: {
          id: noteId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          archivedAt: null
        },
        select: { id: true }
      });
      if (!exists) throw new NotFoundException("Project note was not found");
      throw new ConflictException("Version conflict");
    }
  }

  public async getPublic(token: string): Promise<PublicProjectNote> {
    const note = await this.prisma.projectNote.findUnique({
      where: { publicToken: token }
    });
    if (
      !note ||
      note.archivedAt ||
      note.visibility !== "PUBLIC" ||
      !note.publicToken
    ) {
      throw new NotFoundException("Public project note was not found");
    }
    return {
      title: note.title,
      markdown: note.markdown,
      updatedAt: note.updatedAt.toISOString()
    };
  }

  private async required(
    workspaceId: string,
    projectId: string,
    noteId: string
  ): Promise<ProjectNote> {
    const note = await this.prisma.projectNote.findFirst({
      where: { id: noteId, workspaceId, projectId, archivedAt: null }
    });
    if (!note) throw new NotFoundException("Project note was not found");
    return note;
  }
}

function createPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

function summary(note: ProjectNote): ProjectNoteSummary {
  return {
    id: note.id,
    workspaceId: note.workspaceId,
    projectId: note.projectId,
    title: note.title,
    markdown: note.markdown,
    visibility: note.visibility,
    ...(note.publicToken ? { publicToken: note.publicToken } : {}),
    createdBy: note.createdBy,
    updatedBy: note.updatedBy,
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString()
  };
}
