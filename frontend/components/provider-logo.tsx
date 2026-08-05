import type { IntegrationProvider } from "@seo-platform/contracts";

const PROVIDER_LOGO_ASSETS: Readonly<Record<IntegrationProvider, string>> = {
  XMLSTOCK: "/provider-logos/xmlstock.svg",
  ARSENKIN: "/provider-logos/arsenkin-tools.svg",
  KEYS_SO: "/provider-logos/keys-so.svg"
};

export function ProviderLogo({
  provider,
  size = "regular"
}: Readonly<{
  provider: IntegrationProvider;
  size?: "compact" | "regular";
}>) {
  const label = provider === "XMLSTOCK"
    ? "XMLStock"
    : provider === "ARSENKIN"
      ? "Arsenkin Tools"
      : "Keys.so";

  return (
    <span
      aria-label={label}
      className={`provider-logo ${providerClassName(provider)} ${size}`}
      role="img"
    >
      <img
        alt=""
        aria-hidden="true"
        draggable={false}
        height={48}
        src={PROVIDER_LOGO_ASSETS[provider]}
        width={48}
      />
    </span>
  );
}

function providerClassName(provider: IntegrationProvider): string {
  if (provider === "XMLSTOCK") return "xmlstock";
  if (provider === "ARSENKIN") return "arsenkin";
  return "keys-so";
}
