import type { IntegrationCredentialStatus } from "@seo-platform/contracts";
import { integrationCredentialStatusPresentation } from "../lib/integration-presentation";
import { Icon } from "./icon";

export function IntegrationStatusBadge({
  status
}: Readonly<{ status: IntegrationCredentialStatus }>) {
  const presentation = integrationCredentialStatusPresentation(status);
  return (
    <span
      aria-label={presentation.label}
      className={`integration-status integration-status-icon ${presentation.tone}`}
      role="img"
      title={presentation.label}
    >
      <StatusGlyph tone={presentation.tone} />
      <span className="visually-hidden">{presentation.label}</span>
    </span>
  );
}

function StatusGlyph({
  tone
}: Readonly<{
  tone: "active" | "danger" | "muted" | "pending" | "warning";
}>) {
  if (tone === "active") {
    return <Icon name="check" />;
  }
  if (tone === "warning") {
    return <Icon name="warning" />;
  }
  if (tone === "pending") {
    return <Icon name="clock" />;
  }
  if (tone === "danger") {
    return <Icon name="close" />;
  }
  return <Icon name="minus" />;
}
