import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  MODULE_METADATA
} from "@nestjs/common/constants.js";
import { AppModule } from "../app.module.js";
import { ApiTokenAuthenticationService } from "./api-token-authentication.service.js";
import { IdentityModule } from "./identity.module.js";
import { SessionCookieService } from "./session-cookie.service.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "./session-auth.guard.js";
import { SessionService } from "./session.service.js";

type ClassReference = Function & {
  readonly prototype?: object;
};

const sessionGuards = new Set<ClassReference>([
  SessionAuthGuard,
  CsrfSessionGuard
]);

test("every controller module using session guards imports IdentityModule", () => {
  const visitedModules = new Set<ClassReference>();
  const guardedModules: string[] = [];

  visitModule(AppModule, visitedModules, guardedModules);

  assert.deepEqual(guardedModules.sort(), [
    "ApiTokenModule",
    "BillingModule",
    "CrawlModule",
    "IntegrationModule",
    "KeywordResearchModule",
    "NotificationModule",
    "PageModule",
    "PlatformAdminModule",
    "ProjectNoteModule",
    "RankingModule",
    "RealtimeClientModule",
    "SemanticImportModule",
    "SemanticModule",
    "TenantModule",
    "UploadModule"
  ]);
});

test("IdentityModule exports session guard dependencies to controller modules", () => {
  const exportedProviders = readMetadata<ClassReference>(
    MODULE_METADATA.EXPORTS,
    IdentityModule
  );

  for (const requiredExport of [
    SessionService,
    SessionCookieService,
    ApiTokenAuthenticationService,
    SessionAuthGuard,
    CsrfSessionGuard
  ]) {
    assert.ok(
      exportedProviders.includes(requiredExport),
      `IdentityModule must export ${requiredExport.name}`
    );
  }
});

function visitModule(
  moduleReference: ClassReference,
  visitedModules: Set<ClassReference>,
  guardedModules: string[]
): void {
  if (visitedModules.has(moduleReference)) {
    return;
  }
  visitedModules.add(moduleReference);

  const importedModules = readMetadata<ClassReference>(
    MODULE_METADATA.IMPORTS,
    moduleReference
  );
  const controllers = readMetadata<ClassReference>(
    MODULE_METADATA.CONTROLLERS,
    moduleReference
  );
  const usesSessionGuards = controllers.some(controllerUsesSessionGuard);

  if (usesSessionGuards && moduleReference !== IdentityModule) {
    assert.ok(
      importedModules.includes(IdentityModule),
      `${moduleReference.name} uses session guards and must import IdentityModule`
    );
    guardedModules.push(moduleReference.name);
  }

  for (const importedModule of importedModules) {
    visitModule(importedModule, visitedModules, guardedModules);
  }
}

function controllerUsesSessionGuard(controller: ClassReference): boolean {
  if (metadataUsesSessionGuard(controller)) {
    return true;
  }

  const prototype = controller.prototype;
  if (prototype === undefined) {
    return false;
  }

  return Object.getOwnPropertyNames(prototype).some((propertyName) => {
    if (propertyName === "constructor") {
      return false;
    }
    const method = Object.getOwnPropertyDescriptor(
      prototype,
      propertyName
    )?.value;
    return typeof method === "function" && metadataUsesSessionGuard(method);
  });
}

function metadataUsesSessionGuard(target: object): boolean {
  return readMetadata<ClassReference>(GUARDS_METADATA, target).some((guard) =>
    sessionGuards.has(guard)
  );
}

function readMetadata<T>(metadataKey: string, target: object): readonly T[] {
  const metadata: unknown = Reflect.getMetadata(metadataKey, target);
  return Array.isArray(metadata) ? (metadata as readonly T[]) : [];
}
