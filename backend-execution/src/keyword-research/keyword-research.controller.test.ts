import assert from "node:assert/strict";
import test from "node:test";
import { PATH_METADATA } from "@nestjs/common/constants.js";
import { IntegrationCredentialApiGuard } from "../integrations/integration-credential-api.guard.js";
import { KeywordResearchController } from "./keyword-research.controller.js";

test("keyword research uses the credential-capable internal caller boundary", () => {
  assert.deepEqual(
    Reflect.getMetadata("__guards__", KeywordResearchController),
    [IntegrationCredentialApiGuard]
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, KeywordResearchController),
    "internal/v1/workspaces/:workspaceId/projects/:projectId/keyword-research-runs"
  );
});
