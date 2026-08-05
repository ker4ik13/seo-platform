import type { FastifyRequest } from "fastify";

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

export type AuthenticatedRequest = FastifyRequest & {
  principal?: AuthenticatedPrincipal;
};
