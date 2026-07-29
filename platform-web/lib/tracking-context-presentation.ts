import type {
  TrackingContextSummary,
  TrackingDevice,
  TrackingDomainMatchMode,
  TrackingDomainMatchRule,
  TrackingSearchEngine
} from "@seo-platform/contracts";

export function trackingSearchEngineLabel(
  engine: TrackingSearchEngine
): string {
  return engine === "GOOGLE" ? "Google" : "Яндекс";
}

export function trackingDeviceLabel(device: TrackingDevice): string {
  return device === "DESKTOP" ? "Desktop" : "Mobile";
}

export function trackingGeographyLabel(
  context: TrackingContextSummary
): string {
  const configuration = context.configuration;
  const region =
    configuration.regionLabel ?? configuration.regionCode;
  return region
    ? `${configuration.countryCode} · ${region}`
    : configuration.countryCode;
}

export function trackingDomainMatchModeLabel(
  mode: TrackingDomainMatchMode
): string {
  const labels: Readonly<Record<TrackingDomainMatchMode, string>> = {
    EXACT_HOST: "Точный host",
    INCLUDE_WWW: "С учётом www",
    INCLUDE_SUBDOMAINS: "Включая поддомены",
    CANONICAL_DOMAIN: "Канонический домен",
    ANY_PROJECT_MIRROR: "Любое зеркало проекта",
    SPECIFIC_URL: "Точный URL",
    URL_PREFIX: "Префикс URL"
  };
  return labels[mode];
}

export function trackingDomainMatchLabel(
  rule: TrackingDomainMatchRule
): string {
  const label = trackingDomainMatchModeLabel(rule.mode);
  return rule.mode === "SPECIFIC_URL" || rule.mode === "URL_PREFIX"
    ? `${label} · ${rule.value}`
    : label;
}
