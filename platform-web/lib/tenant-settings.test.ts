import assert from "node:assert/strict";
import test from "node:test";
import {
  canArchiveProject,
  canRestoreProject,
  canUpdateProject,
  canUpdateWorkspace
} from "./app-permissions.ts";
import type { AppProject, AppWorkspace } from "./app-types.ts";
import { BrowserApiError } from "./browser-api.ts";
import {
  isDuplicateDomainConflict,
  isVersionConflict,
  projectLifecycleConfirmationMatches,
  projectSettingsDraftAfterSave,
  projectSettingsDirty,
  projectStatusLabel,
  projectUpdateInput,
  tenantApiFieldErrors,
  tenantOperationFailure,
  validateProjectSettings,
  validateWorkspaceSettings,
  workspaceSettingsDraftAfterSave,
  workspaceSettingsDirty,
  workspaceStatusLabel,
  workspaceUpdateInput
} from "./tenant-settings.ts";

const workspace: AppWorkspace = {
  id: "workspace-id",
  name: "SEO Team",
  slug: "seo-team",
  locale: "ru",
  timezone: "Europe/Moscow",
  status: "ACTIVE",
  roleCode: "OWNER",
  version: 4
};

const project: AppProject = {
  id: "project-id",
  workspaceId: workspace.id,
  name: "Main site",
  slug: "main-site",
  domain: "example.test",
  locale: "ru",
  timezone: "Europe/Moscow",
  status: "ACTIVE",
  version: 7
};

test("matches tenant mutation permissions used by the API role matrix", () => {
  assert.equal(canUpdateWorkspace("OWNER"), true);
  assert.equal(canUpdateWorkspace("ADMIN"), true);
  assert.equal(canUpdateWorkspace("SEO_LEAD"), false);
  assert.equal(canUpdateProject("SEO_SPECIALIST"), true);
  assert.equal(canArchiveProject("SEO_LEAD"), true);
  assert.equal(canRestoreProject("SEO_LEAD"), false);
  assert.equal(canRestoreProject("ADMIN"), true);
  assert.equal(canUpdateProject("UNKNOWN"), false);
});

test("validates and normalizes workspace settings payloads", () => {
  assert.deepEqual(
    validateWorkspaceSettings({
      name: " ",
      locale: "x",
      timezone: "Mars/Olympus"
    }),
    {
      name: "Введите название.",
      locale: "Укажите локаль BCP 47, например ru или en-US.",
      timezone: "Укажите часовой пояс IANA, например Europe/Moscow или UTC."
    }
  );
  assert.deepEqual(
    workspaceUpdateInput({
      name: " SEO Team 2 ",
      locale: " en-US ",
      timezone: " UTC "
    }),
    { name: "SEO Team 2", locale: "en-US", timezone: "UTC" }
  );
  assert.equal(
    workspaceSettingsDirty(workspace, {
      name: workspace.name,
      locale: workspace.locale,
      timezone: workspace.timezone
    }),
    false
  );
});

test("rejects unsafe project domains and builds an explicit duplicate retry", () => {
  assert.equal(
    validateProjectSettings({
      name: "Main site",
      domain: "https://user:pass@example.test/path",
      locale: "ru",
      timezone: "UTC"
    }).domain,
    "Укажите домен без пути, параметров, учётных данных и номера порта."
  );
  assert.deepEqual(
    projectUpdateInput(
      {
        name: " Main site ",
        domain: "HTTPS://EXAMPLE.TEST.",
        locale: "ru",
        timezone: "UTC"
      },
      true
    ),
    {
      name: "Main site",
      domain: "example.test",
      locale: "ru",
      timezone: "UTC",
      confirmDuplicateDomain: true
    }
  );
  assert.equal(
    projectSettingsDirty(project, {
      name: project.name,
      domain: "changed.test",
      locale: project.locale,
      timezone: project.timezone
    }),
    true
  );
});

test("classifies version and duplicate conflicts without projecting private details", () => {
  const version = new BrowserApiError(412, "VERSION_CONFLICT", "changed");
  const duplicate = new BrowserApiError(
    409,
    "RESOURCE_STATE_CONFLICT",
    "duplicate"
  );
  assert.equal(isVersionConflict(version), true);
  assert.equal(isDuplicateDomainConflict(duplicate), true);
  assert.equal(isDuplicateDomainConflict(version), false);
});

test("maps only allowlisted API fields and keeps actionable failure metadata", () => {
  const error = new BrowserApiError(
    422,
    "VALIDATION_ERROR",
    "invalid",
    [
      { path: "body.domain", code: "INVALID_DOMAIN" },
      { path: "privateField", code: "PRIVATE" }
    ],
    "request-id"
  );
  assert.deepEqual(tenantApiFieldErrors(error, ["domain"]), {
    domain: "Проверьте значение поля."
  });
  assert.deepEqual(tenantOperationFailure(error, true), {
    message: "Проверьте отмеченные поля и повторите попытку.",
    requestId: "request-id"
  });
  assert.match(tenantOperationFailure(error, false).message, /Черновик/u);
});

test("provides stable human-readable tenant status labels", () => {
  assert.equal(workspaceStatusLabel("READ_ONLY"), "Только чтение");
  assert.equal(projectStatusLabel("ARCHIVED"), "В архиве");
});

test("does not discard a draft changed while a save was in flight", () => {
  const submittedWorkspace = {
    name: workspace.name,
    locale: workspace.locale,
    timezone: workspace.timezone
  };
  const changedWorkspace = {
    ...submittedWorkspace,
    name: "Typed while saving"
  };
  const updatedWorkspace = {
    ...workspace,
    name: "Accepted server value",
    version: workspace.version + 1
  };
  assert.equal(
    workspaceSettingsDraftAfterSave(
      updatedWorkspace,
      submittedWorkspace,
      changedWorkspace
    ),
    changedWorkspace
  );
  assert.deepEqual(
    workspaceSettingsDraftAfterSave(
      updatedWorkspace,
      submittedWorkspace,
      submittedWorkspace
    ),
    {
      name: updatedWorkspace.name,
      locale: updatedWorkspace.locale,
      timezone: updatedWorkspace.timezone
    }
  );

  const submittedProject = {
    name: project.name,
    domain: project.domain,
    locale: project.locale,
    timezone: project.timezone
  };
  const changedProject = {
    ...submittedProject,
    domain: "typed-while-saving.test"
  };
  assert.equal(
    projectSettingsDraftAfterSave(
      { ...project, version: project.version + 1 },
      submittedProject,
      changedProject
    ),
    changedProject
  );
});

test("requires lifecycle confirmation again after a concurrent rename", () => {
  assert.equal(projectLifecycleConfirmationMatches(project, project.name), true);
  assert.equal(
    projectLifecycleConfirmationMatches(
      { ...project, name: "Renamed project" },
      project.name
    ),
    false
  );
});
