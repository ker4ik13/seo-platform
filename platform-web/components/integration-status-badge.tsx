import type { IntegrationCredentialStatus } from "@seo-platform/contracts";
import { integrationCredentialStatusPresentation } from "../lib/integration-presentation";

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
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="m5 10.2 3.1 3.1L15.4 6" />
      </svg>
    );
  }
  if (tone === "warning") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="M10 3 2.8 16h14.4L10 3Z" />
        <path d="M10 7.2v4.4M10 14.1v.1" />
      </svg>
    );
  }
  if (tone === "pending") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="6.6" />
        <path d="M10 6.2v4.2l2.6 1.6" />
      </svg>
    );
  }
  if (tone === "danger") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="6.6" />
        <path d="m7.6 7.6 4.8 4.8m0-4.8-4.8 4.8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="6.6" />
      <path d="M7 10h6" />
    </svg>
  );
}
