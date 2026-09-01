import type { FastifyRequest } from "fastify";
import type { ApiTokenScope } from "@seo-platform/contracts";

export interface RequestContext {
  readonly requestId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface SessionCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly csrfToken: string;
}

export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly sessionFamilyId: string;
  readonly authenticatedAt: Date;
  readonly expiresAt: Date;
}

export interface ApiTokenAuthorization {
  readonly tokenId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly scopes: readonly ApiTokenScope[];
  readonly allProjects: boolean;
  readonly projectIds: readonly string[];
}

export type AuthenticatedRequest = FastifyRequest & {
  principal?: AuthenticatedPrincipal;
  apiTokenAuthorization?: ApiTokenAuthorization;
};
