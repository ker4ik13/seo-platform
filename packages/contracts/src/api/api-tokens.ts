export const apiTokenScopes = [
  "projects:read",
  "projects:write",
  "semantics:read",
  "semantics:write",
  "positions:read",
  "positions:run",
  "frequency:read",
  "frequency:run",
  "ai:read",
  "ai:run",
  "research:read",
  "research:run",
  "audits:read",
  "audits:run",
  "pages:read",
  "pages:write",
  "notes:read",
  "notes:write",
  "integrations:read",
  "integrations:write",
  "automations:read",
  "automations:manage"
] as const;

export type ApiTokenScope = (typeof apiTokenScopes)[number];

export interface ApiTokenSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly ApiTokenScope[];
  readonly allProjects: boolean;
  readonly projectIds: readonly string[];
  readonly status: "ACTIVE" | "EXPIRED" | "REVOKED";
  readonly expiresAt?: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
  readonly previousTokenValidUntil?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiTokenCollection {
  readonly tokens: readonly ApiTokenSummary[];
}

export interface CreateApiTokenInput {
  readonly name: string;
  readonly scopes: readonly ApiTokenScope[];
  readonly allProjects: boolean;
  readonly projectIds: readonly string[];
  readonly expiresAt: string | null;
}

export type UpdateApiTokenInput = CreateApiTokenInput;

/** The plaintext secret is returned only for create and rotate responses. */
export interface IssuedApiToken extends ApiTokenSummary {
  readonly token: string;
}
