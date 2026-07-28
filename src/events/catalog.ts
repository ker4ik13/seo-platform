export const domainEventTypes = {
  userCreated: "identity.user.created.v1",
  emailVerificationRequested: "identity.email-verification.requested.v1",
  userEmailVerified: "identity.user.email-verified.v1",
  passwordResetRequested: "identity.password-reset.requested.v1",
  userPasswordChanged: "identity.user.password-changed.v1",
  workspaceCreated: "workspace.created.v1",
  workspaceUpdated: "workspace.updated.v1",
  workspaceInviteRequested: "workspace.invite.requested.v1",
  workspaceInviteAccepted: "workspace.invite.accepted.v1",
  workspaceInviteRevoked: "workspace.invite.revoked.v1",
  workspaceMemberChanged: "workspace.member.changed.v1",
  projectCreated: "project.created.v1",
  projectUpdated: "project.updated.v1",
  projectArchived: "project.archived.v1",
  projectRestored: "project.restored.v1",
  jobCreated: "job.created.v1",
  jobProgressed: "job.progressed.v1",
  jobCompleted: "job.completed.v1",
  jobFailed: "job.failed.v1",
  semanticVersionCreated: "semantics.version.created.v1",
  rankCheckCompleted: "seo.rank-check.completed.v1",
  billingReservationCreated: "billing.reservation.created.v1",
  billingReservationSettled: "billing.reservation.settled.v1"
} as const;

export type DomainEventType =
  (typeof domainEventTypes)[keyof typeof domainEventTypes];
