import { projectAccessLevels } from "@seo-platform/contracts";
import { cache } from "react";
import { cookies } from "next/headers";
import type {
  AppProject,
  AppUser,
  AppWorkspace,
  ProtectedAppContext
} from "./app-types";
import {
  type ProtectedAppBaseContext,
  resolveExplicitProjectAppContext
} from "./project-app-context";
import { platformApiInternalOrigin } from "./server-runtime-origin";

export class PlatformApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

const loadProtectedAppBaseContext = cache(
  async (): Promise<ProtectedAppBaseContext> => {
    const [accountPayload, workspacesPayload] = await Promise.all([
      platformApiData<unknown>("/api/v1/me"),
      platformApiCollection("/api/v1/workspaces")
    ]);
    return {
      user: accountUser(accountPayload),
      workspaces: workspacesPayload.map(appWorkspace)
    };
  }
);

export const loadProtectedAppContext = cache(
  async (): Promise<ProtectedAppContext> => {
    const base = await loadProtectedAppBaseContext();
    const cookieStore = await cookies();
    const preferredWorkspaceId = cookieStore.get("seo_workspace")?.value;
    const workspace =
      base.workspaces.find(({ id }) => id === preferredWorkspaceId) ??
      base.workspaces[0];

    if (!workspace) {
      return {
        ...base,
        projects: []
      };
    }

    const projectsPayload = await platformApiCollection(
      `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/projects`
    );
    const projects = projectsPayload.map(appProject);
    const preferredProjectId = cookieStore.get("seo_project")?.value;
    const project =
      projects.find(({ id }) => id === preferredProjectId) ?? projects[0];

    return {
      ...base,
      workspace,
      projects,
      ...(project ? { project } : {})
    };
  }
);

export const loadProtectedProjectAppContext = cache(
  async (projectId: string): Promise<ProtectedAppContext> => {
    const base = await loadProtectedAppBaseContext();
    const context = await resolveExplicitProjectAppContext(
      base,
      projectId,
      {
        loadProject: async (explicitProjectId) =>
          appProject(
            await platformApiData<unknown>(
              `/api/v1/projects/${encodeURIComponent(explicitProjectId)}`
            )
          ),
        loadWorkspaceProjects: async (workspaceId) =>
          (
            await platformApiCollection(
              `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`
            )
          ).map(appProject)
      }
    );
    if (!context) throw invalidResponse();
    return context;
  }
);

async function platformApiCollection(path: string): Promise<readonly unknown[]> {
  const payload = await platformApiJson(path);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  ) {
    throw invalidResponse();
  }
  return payload.data;
}

async function platformApiData<Data>(
  path: string
): Promise<Data> {
  const payload = await platformApiJson(path);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload)
  ) {
    throw invalidResponse();
  }
  return payload.data as Data;
}

async function platformApiJson(path: string): Promise<unknown> {
  const headers = new Headers({
    Accept: "application/json"
  });
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  if (cookieHeader) headers.set("Cookie", cookieHeader);

  let response: Response;
  try {
    response = await fetch(platformApiUrl(path), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(3_000)
    });
  } catch {
    throw new PlatformApiError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Platform API is unavailable"
    );
  }

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const apiError = readApiError(payload);
    throw new PlatformApiError(
      response.status,
      apiError.code,
      apiError.message
    );
  }
  return payload;
}

function platformApiUrl(path: string): URL {
  return new URL(path, platformApiInternalOrigin());
}

function readApiError(payload: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null
  ) {
    const code =
      "code" in payload.error && typeof payload.error.code === "string"
        ? payload.error.code
        : "INTERNAL_ERROR";
    const message =
      "message" in payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : "Platform API request failed";
    return { code, message };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "Platform API request failed"
  };
}

function accountUser(payload: unknown): AppUser {
  const account = record(payload);
  const user = record(account.user);
  return {
    id: stringValue(user.id),
    email: stringValue(user.email),
    emailVerified: booleanValue(user.emailVerified),
    displayName: stringValue(user.displayName),
    locale: stringValue(user.locale),
    timezone: stringValue(user.timezone),
    ...(user.avatarUpdatedAt === undefined
      ? {}
      : { avatarUpdatedAt: stringValue(user.avatarUpdatedAt) })
  };
}

function appWorkspace(payload: unknown): AppWorkspace {
  const workspace = record(payload);
  const owner = record(workspace.owner);
  const status = stringValue(workspace.status);
  if (!["ACTIVE", "READ_ONLY", "SUSPENDED"].includes(status)) {
    throw invalidResponse();
  }
  return {
    id: stringValue(workspace.id),
    name: stringValue(workspace.name),
    locale: stringValue(workspace.locale),
    timezone: stringValue(workspace.timezone),
    slug: stringValue(workspace.slug),
    status: status as AppWorkspace["status"],
    roleCode: stringValue(workspace.roleCode),
    owner: {
      userId: stringValue(owner.userId),
      email: stringValue(owner.email),
      displayName: stringValue(owner.displayName)
    },
    ...(workspace.avatarUpdatedAt === undefined
      ? {}
      : { avatarUpdatedAt: stringValue(workspace.avatarUpdatedAt) }),
    version: numberValue(workspace.version)
  };
}

function appProject(payload: unknown): AppProject {
  const project = record(payload);
  const status = stringValue(project.status);
  if (!["DRAFT", "ACTIVE", "ARCHIVED"].includes(status)) {
    throw invalidResponse();
  }
  const projectAccessLevel = appProjectAccessLevel(
    project.projectAccessLevel
  );
  return {
    id: stringValue(project.id),
    workspaceId: stringValue(project.workspaceId),
    name: stringValue(project.name),
    slug: stringValue(project.slug),
    locale: stringValue(project.locale),
    timezone: stringValue(project.timezone),
    domain: stringValue(project.domain),
    status: status as AppProject["status"],
    ownerUserId: stringValue(project.ownerUserId),
    ...(project.logoSource === undefined
      ? {}
      : { logoSource: projectLogoSource(project.logoSource) }),
    ...(project.logoUpdatedAt === undefined
      ? {}
      : { logoUpdatedAt: stringValue(project.logoUpdatedAt) }),
    ...(project.activeOperationCount === undefined
      ? {}
      : {
          activeOperationCount: nonNegativeNumberValue(
            project.activeOperationCount
          )
        }),
    ...(projectAccessLevel ? { projectAccessLevel } : {}),
    version: numberValue(project.version)
  };
}

function projectLogoSource(value: unknown): "CUSTOM" | "DISCOVERED" {
  if (value !== "CUSTOM" && value !== "DISCOVERED") throw invalidResponse();
  return value;
}

function appProjectAccessLevel(
  value: unknown
): AppProject["projectAccessLevel"] {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !projectAccessLevels.some((level) => level === value)
  ) {
    throw invalidResponse();
  }
  return value as AppProject["projectAccessLevel"];
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw invalidResponse();
  return value;
}

function numberValue(value: unknown): number {
  if (!Number.isInteger(value)) throw invalidResponse();
  return value as number;
}

function nonNegativeNumberValue(value: unknown): number {
  const result = numberValue(value);
  if (result < 0) throw invalidResponse();
  return result;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidResponse();
  return value;
}

function invalidResponse(): PlatformApiError {
  return new PlatformApiError(
    502,
    "INVALID_UPSTREAM_RESPONSE",
    "Platform API returned an invalid response"
  );
}
