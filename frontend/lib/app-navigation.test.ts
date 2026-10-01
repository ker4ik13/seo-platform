import assert from "node:assert/strict";
import test from "node:test";
import {
  appNavigationSection,
  appProjectIdFromPath,
  projectSwitchHref,
  readLastWorkspaceProjectId,
  resolveWorkspaceProjectPreference,
  shouldShowWorkspaceCreationAction,
  writeLastWorkspaceProjectId
} from "./app-navigation.ts";

const projectId = "019fd395-bc13-74eb-80c5-f3e7872bcc2b";

test("derives the persistent shell section from protected routes", () => {
  assert.equal(appNavigationSection("/app"), "overview");
  assert.equal(appNavigationSection("/app/semantics"), "semantics");
  assert.equal(appNavigationSection("/app/tasks/frequency/id"), "tasks");
  assert.equal(appNavigationSection(`/app/projects/${projectId}/pages`), "pages");
  assert.equal(
    appNavigationSection(`/app/projects/${projectId}/settings/general`),
    "settings"
  );
  assert.equal(
    appNavigationSection(`/app/projects/${projectId}/rankings/contexts`),
    "settings"
  );
  assert.equal(
    appNavigationSection(`/app/projects/${projectId}/tools/http-status-checker`),
    "crawl"
  );
});

test("changing project preserves the screen and replaces its explicit scope", () => {
  assert.equal(projectSwitchHref(`/app/projects/${projectId}/tools/serp`, "new-project"), "/app/projects/new-project/tools/serp");
  assert.equal(projectSwitchHref("/app/rankings", projectId), "/app/rankings");
  assert.equal(projectSwitchHref("/app/settings/integrations", projectId), "/app/settings/integrations");
  assert.equal(projectSwitchHref("/app/tasks/rank/old-operation", projectId), "/app/tasks");
  assert.equal(projectSwitchHref("/app/projects/old/notes/old-note", projectId), `/app/projects/${projectId}/notes`);
  assert.equal(projectSwitchHref("/app/projects/old/notes", undefined), "/app");
});

test("extracts only a canonical project UUID from an explicit project route", () => {
  assert.equal(
    appProjectIdFromPath(`/app/projects/${projectId}/settings/general?tab=a`),
    projectId
  );
  assert.equal(appProjectIdFromPath("/app/projects/not-a-uuid/settings"), undefined);
  assert.equal(appProjectIdFromPath(`/app/tasks/${projectId}`), undefined);
});

test("offers workspace creation until the user owns a workspace", () => {
  const currentUserId = "019fd395-bc13-74eb-80c5-f3e7872bcc20";
  const foreignWorkspace = {
    owner: { userId: "019fd395-bc13-74eb-80c5-f3e7872bcc21" }
  };
  const ownedWorkspace = {
    owner: { userId: currentUserId }
  };

  assert.equal(shouldShowWorkspaceCreationAction(currentUserId, []), true);
  assert.equal(
    shouldShowWorkspaceCreationAction(currentUserId, [foreignWorkspace]),
    true
  );
  assert.equal(
    shouldShowWorkspaceCreationAction(currentUserId, [
      foreignWorkspace,
      ownedWorkspace
    ]),
    false
  );
});

test("keeps the last project isolated by user and workspace", () => {
  const storage = new MemoryStorage();
  const userA = "019fd395-bc13-74eb-80c5-f3e7872bcc20";
  const userB = "019fd395-bc13-74eb-80c5-f3e7872bcc21";
  const workspaceA = "019fd395-bc13-74eb-80c5-f3e7872bcc22";
  const workspaceB = "019fd395-bc13-74eb-80c5-f3e7872bcc23";
  const projectA = "019fd395-bc13-74eb-80c5-f3e7872bcc24";
  const projectB = "019fd395-bc13-74eb-80c5-f3e7872bcc25";

  writeLastWorkspaceProjectId(storage, userA, workspaceA, projectA);
  writeLastWorkspaceProjectId(storage, userA, workspaceB, projectB);
  writeLastWorkspaceProjectId(storage, userB, workspaceA, projectB);

  assert.equal(
    readLastWorkspaceProjectId(storage, userA, workspaceA),
    projectA
  );
  assert.equal(
    readLastWorkspaceProjectId(storage, userA, workspaceB),
    projectB
  );
  assert.equal(
    readLastWorkspaceProjectId(storage, userB, workspaceA),
    projectB
  );

  writeLastWorkspaceProjectId(storage, userA, workspaceA, undefined);
  assert.equal(
    readLastWorkspaceProjectId(storage, userA, workspaceA),
    undefined
  );
  assert.equal(
    readLastWorkspaceProjectId(storage, userA, workspaceB),
    projectB
  );
});

test("rejects malformed last-project preferences", () => {
  const storage = new MemoryStorage();
  const userId = "019fd395-bc13-74eb-80c5-f3e7872bcc20";
  const workspaceId = "019fd395-bc13-74eb-80c5-f3e7872bcc22";

  writeLastWorkspaceProjectId(storage, userId, workspaceId, "not-a-project");
  assert.equal(
    readLastWorkspaceProjectId(storage, userId, workspaceId),
    undefined
  );
  assert.equal(
    readLastWorkspaceProjectId(storage, "not-a-user", workspaceId),
    undefined
  );
});

test("falls back when the remembered workspace project is unavailable", () => {
  const projects = [
    { id: "019fd395-bc13-74eb-80c5-f3e7872bcc24", name: "Первый" },
    { id: "019fd395-bc13-74eb-80c5-f3e7872bcc25", name: "Второй" }
  ];

  assert.equal(
    resolveWorkspaceProjectPreference(projects, projects[1]!.id)?.id,
    projects[1]!.id
  );
  assert.equal(
    resolveWorkspaceProjectPreference(
      projects,
      "019fd395-bc13-74eb-80c5-f3e7872bcc26"
    )?.id,
    projects[0]!.id
  );
  assert.equal(resolveWorkspaceProjectPreference([], projects[1]!.id), undefined);
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
