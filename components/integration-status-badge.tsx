import type { IntegrationCredentialStatus } from "@seo-platform/contracts";
import { integrationCredentialStatusPresentation } from "../lib/integration-presentation";

export function IntegrationStatusBadge({
  status
}: Readonly<{ status: IntegrationCredentialStatus }>) {
  const presentation = integrationCredentialStatusPresentation(status);
  return (
    <span className={`integration-status ${presentation.tone}`}>
      {presentation.label}
    </span>
  );
}
