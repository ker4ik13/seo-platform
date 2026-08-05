import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { loadAppConfig } from "../config/app-config.js";
import { SemanticImportController } from "../imports/semantic-import.controller.js";
import { UploadController } from "../uploads/upload.controller.js";
import { PlatformApiGuard } from "./platform-api.guard.js";

const platformToken = "p".repeat(32);
const seoDataToken = "s".repeat(32);
const credentialToken = "c".repeat(32);

test("protects only Platform API HTTP route groups", () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, UploadController),
    [PlatformApiGuard]
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, SemanticImportController),
    [PlatformApiGuard]
  );
});

test("rejects cross-token, duplicate and malformed headers", () => {
  const guard = new PlatformApiGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_JOBS_TOKEN: platformToken,
      JOBS_TO_SEO_DATA_TOKEN: seoDataToken
    })
  );
  assert.equal(guard.canActivate(context(platformToken)), true);
  for (const token of [seoDataToken, credentialToken, "short"]) {
    assert.throws(
      () => guard.canActivate(context(token)),
      UnauthorizedException
    );
  }
  assert.throws(
    () =>
      guard.canActivate(
        context(platformToken, [
          "x-internal-token",
          platformToken,
          "X-Internal-Token",
          platformToken
        ])
      ),
    UnauthorizedException
  );
  assert.throws(
    () => guard.canActivate(context(` ${platformToken}`)),
    UnauthorizedException
  );
});

test("fails closed when the HTTP audience token is absent", () => {
  const guard = new PlatformApiGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test"
    })
  );
  assert.throws(
    () => guard.canActivate(context(platformToken)),
    ServiceUnavailableException
  );
});

function context(
  token: string,
  rawHeaders?: readonly string[]
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { "x-internal-token": token },
        ...(rawHeaders ? { raw: { rawHeaders } } : {})
      })
    })
  } as unknown as ExecutionContext;
}
