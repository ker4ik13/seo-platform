import type { Logger } from "@nestjs/common";
import type {
  AuditRecord,
  AuditService
} from "../audit/audit.service.js";

export async function recordCommittedAudit(
  audit: AuditService,
  logger: Pick<Logger, "error">,
  input: AuditRecord
): Promise<void> {
  try {
    await audit.record(input);
  } catch {
    // The owning service already committed its mutation and transactional
    // outbox event. A post-commit audit outage must not turn that committed
    // command into a false failure that cannot be retried safely.
    logger.error(
      `Unable to persist success audit event action=${input.action} requestId=${input.requestId}`
    );
  }
}
