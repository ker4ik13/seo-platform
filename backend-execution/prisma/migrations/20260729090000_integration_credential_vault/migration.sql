-- New credentials cannot be used by workers before a provider-specific
-- server-side verification succeeds.
ALTER TYPE "CredentialStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION' BEFORE 'ACTIVE';
