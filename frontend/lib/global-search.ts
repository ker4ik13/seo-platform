import type { AppProject, AppWorkspace } from "./app-types.ts";

export type SearchProject = Pick<AppProject, "id" | "workspaceId" | "name" | "domain" | "version">;
export function parseSearchProjects(value: unknown, workspaceId: string): readonly SearchProject[] {
  if (!Array.isArray(value)) throw new TypeError("Invalid project catalog");
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new TypeError("Invalid project");
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || row.workspaceId !== workspaceId ||
        typeof row.name !== "string" || typeof row.domain !== "string" ||
        typeof row.version !== "number" || !Number.isSafeInteger(row.version)) throw new TypeError("Invalid project scope");
    return { id: row.id, workspaceId, name: row.name, domain: row.domain, version: row.version };
  });
}

export function searchTenantCatalog(workspaces: readonly AppWorkspace[], projects: readonly SearchProject[], query: string) {
  const words = query.trim().toLocaleLowerCase("ru").split(/\s+/u).filter(Boolean);
  const matches = (values: readonly string[]) => {
    const text = values.join(" ").toLocaleLowerCase("ru");
    return words.every((word) => text.includes(word));
  };
  const allowed = new Set(workspaces.map(({ id }) => id));
  return {
    workspaces: workspaces.filter((workspace) => matches([workspace.name, workspace.owner.displayName, workspace.owner.email])),
    projects: projects.filter((project) => allowed.has(project.workspaceId) && matches([project.name, project.domain, workspaces.find(({ id }) => id === project.workspaceId)?.name ?? ""]))
  };
}
