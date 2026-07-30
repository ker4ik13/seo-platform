import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppProject,
  AppUser,
  AppWorkspace
} from "./app-types.ts";
import {
  type ProtectedAppBaseContext,
  resolveExplicitProjectAppContext
} from "./project-app-context.ts";

const user: AppUser = {
  id: "user-id",
  email: "user@example.test",
  emailVerified: true,
  displayName: "User",
  locale: "ru",
  timezone: "Europe/Moscow"
};

const suspendedWorkspace: AppWorkspace = {
  id: "suspended-workspace",
  name: "Suspended",
  slug: "suspended",
  locale: "ru",
  timezone: "Europe/Moscow",
  status: "SUSPENDED",
  roleCode: "OWNER",
  version: 1
};

const targetWorkspace: AppWorkspace = {
  id: "target-workspace",
  name: "Target",
  slug: "target",
  status: "ACTIVE",
  roleCode: "OWNER",
  locale: "ru",
  timezone: "Europe/Moscow",
  version: 1
};

const project: AppProject = {
  id: "target-project",
  workspaceId: targetWorkspace.id,
  name: "Target project",
  slug: "target-project",
  domain: "example.test",
  locale: "ru",
  timezone: "Europe/Moscow",
  status: "ACTIVE",
  version: 1
};

const base: ProtectedAppBaseContext = {
  user,
  workspaces: [suspendedWorkspace, targetWorkspace]
};

test("explicit project resolution never loads projects for a preferred workspace", async () => {
  const loadedWorkspaceIds: string[] = [];
  const result = await resolveExplicitProjectAppContext(
    base,
    project.id,
    {
      loadProject: async (projectId) => {
        assert.equal(projectId, project.id);
        return project;
      },
      loadWorkspaceProjects: async (workspaceId) => {
        loadedWorkspaceIds.push(workspaceId);
        return [project];
      }
    }
  );

  assert.equal(result?.workspace?.id, targetWorkspace.id);
  assert.equal(result?.project?.id, project.id);
  assert.deepEqual(loadedWorkspaceIds, [targetWorkspace.id]);
});

test("explicit project resolution preserves project loader errors", async () => {
  const notFound = Object.assign(new Error("not found"), {
    status: 404
  });

  await assert.rejects(
    resolveExplicitProjectAppContext(base, project.id, {
      loadProject: async () => {
        throw notFound;
      },
      loadWorkspaceProjects: async () => {
        throw new Error("must not load workspace projects");
      }
    }),
    (error: unknown) => error === notFound
  );
});

test("explicit project resolution fails closed for a foreign project list", async () => {
  const result = await resolveExplicitProjectAppContext(
    base,
    project.id,
    {
      loadProject: async () => project,
      loadWorkspaceProjects: async () => [
        {
          ...project,
          id: "foreign-project",
          workspaceId: suspendedWorkspace.id
        }
      ]
    }
  );

  assert.equal(result, undefined);
});

test("explicit project resolution rejects a mismatched project response", async () => {
  let workspaceProjectsLoaded = false;
  const result = await resolveExplicitProjectAppContext(
    base,
    project.id,
    {
      loadProject: async () => ({
        ...project,
        id: "another-project"
      }),
      loadWorkspaceProjects: async () => {
        workspaceProjectsLoaded = true;
        return [];
      }
    }
  );

  assert.equal(result, undefined);
  assert.equal(workspaceProjectsLoaded, false);
});
