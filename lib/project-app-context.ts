import type {
  AppProject,
  AppUser,
  AppWorkspace,
  ProtectedAppContext
} from "./app-types";

export interface ProtectedAppBaseContext {
  readonly user: AppUser;
  readonly workspaces: readonly AppWorkspace[];
}

export interface ExplicitProjectContextSource {
  readonly loadProject: (projectId: string) => Promise<AppProject>;
  readonly loadWorkspaceProjects: (
    workspaceId: string
  ) => Promise<readonly AppProject[]>;
}

export async function resolveExplicitProjectAppContext(
  base: ProtectedAppBaseContext,
  projectId: string,
  source: ExplicitProjectContextSource
): Promise<ProtectedAppContext | undefined> {
  const project = await source.loadProject(projectId);
  if (project.id !== projectId) return undefined;
  const workspace = base.workspaces.find(
    ({ id }) => id === project.workspaceId
  );
  if (!workspace) return undefined;

  const projects = await source.loadWorkspaceProjects(workspace.id);
  if (projects.some(({ workspaceId }) => workspaceId !== workspace.id)) {
    return undefined;
  }

  return {
    user: base.user,
    workspaces: base.workspaces,
    workspace,
    projects: projects.some(({ id }) => id === project.id)
      ? projects
      : [project, ...projects],
    project
  };
}
