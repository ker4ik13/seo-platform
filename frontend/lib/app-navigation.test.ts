import assert from "node:assert/strict";
import test from "node:test";
import {
  appNavigationSection,
  appProjectIdFromPath
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
    appNavigationSection(`/app/projects/${projectId}/tools/http-status-checker`),
    "tools"
  );
});

test("extracts only a canonical project UUID from an explicit project route", () => {
  assert.equal(
    appProjectIdFromPath(`/app/projects/${projectId}/settings/general?tab=a`),
    projectId
  );
  assert.equal(appProjectIdFromPath("/app/projects/not-a-uuid/settings"), undefined);
  assert.equal(appProjectIdFromPath(`/app/tasks/${projectId}`), undefined);
});
