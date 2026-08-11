import type {
  SessionSummary,
  UserSessionSummary,
  UserSummary
} from "@seo-platform/contracts";
import type { Session, User } from "../generated/prisma/client.js";

export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    email: user.emailDisplay,
    emailVerified: user.emailVerifiedAt !== null,
    displayName: user.displayName,
    locale: user.locale,
    timezone: user.timezone,
    ...(user.country ? { country: user.country } : {}),
    ...(user.avatarUpdatedAt
      ? { avatarUpdatedAt: user.avatarUpdatedAt.toISOString() }
      : {}),
    status:
      user.status === "PENDING_VERIFICATION"
        ? "PENDING_VERIFICATION"
        : user.status === "ACTIVE"
          ? "ACTIVE"
          : "SUSPENDED",
    createdAt: user.createdAt.toISOString()
  };
}

export function toSessionSummary(session: Session): SessionSummary {
  return {
    id: session.id,
    authenticatedAt: session.authenticatedAt.toISOString(),
    accessExpiresAt: session.accessExpiresAt.toISOString(),
    expiresAt: session.expiresAt.toISOString()
  };
}

export function toUserSessionSummary(
  session: Session,
  currentSessionId: string
): UserSessionSummary {
  return {
    ...toSessionSummary(session),
    current: session.id === currentSessionId,
    ...(session.userAgent ? { userAgent: session.userAgent } : {}),
    ...(session.ipAddress ? { ipAddress: session.ipAddress } : {}),
    lastUsedAt: session.lastUsedAt.toISOString(),
    createdAt: session.createdAt.toISOString()
  };
}
