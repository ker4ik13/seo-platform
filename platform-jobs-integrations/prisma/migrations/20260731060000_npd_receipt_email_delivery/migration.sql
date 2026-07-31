BEGIN;

ALTER TABLE "auth_email_delivery_attempts"
  DROP CONSTRAINT "auth_email_delivery_attempts_event_type_check";

ALTER TABLE "auth_email_delivery_attempts"
  ADD CONSTRAINT "auth_email_delivery_attempts_event_type_check" CHECK (
    "event_type" IN (
      'identity.email-verification.requested.v1',
      'identity.password-reset.requested.v1',
      'workspace.invite.requested.v1',
      'billing.npd-receipt.delivery-requested.v1'
    )
  );

COMMIT;
