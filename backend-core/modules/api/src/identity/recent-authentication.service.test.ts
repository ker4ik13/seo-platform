import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import type { AuthenticatedPrincipal } from "./identity.types.js";
import { RecentAuthenticationService } from "./recent-authentication.service.js";

const principal: AuthenticatedPrincipal = {
  userId: "01900000-0000-7000-8000-000000000001",
  sessionId: "01900000-0000-7000-8000-000000000002",
  sessionFamilyId: "01900000-0000-7000-8000-000000000003",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 15 * 60 * 1_000)
};

test("allows a recent session and rejects a stale session", () => {
  const service = new RecentAuthenticationService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      AUTH_RECENT_AUTHENTICATION_MINUTES: "10"
    })
  );

  assert.doesNotThrow(() => service.assert(principal));
  assert.throws(
    () =>
      service.assert({
        ...principal,
        authenticatedAt: new Date(Date.now() - 11 * 60 * 1_000)
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 401 &&
      error.code === "REAUTHENTICATION_REQUIRED"
  );
});
