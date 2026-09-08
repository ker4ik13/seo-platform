
import { UiElement } from "./ui-locale";
export function SearchEngineLogo({
  engine,
  size = "regular"
}: Readonly<{
  engine: "GOOGLE" | "YANDEX";
  size?: "compact" | "regular";
}>) {
  if (engine === "YANDEX") {
    return (
      <UiElement tag="span" uiLabels={{"aria-label": "Яндекс"}}

        className={`search-engine-logo yandex ${size}`}
        role="img"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M13.9 3.25c-3.72 0-6.36 2.19-6.36 5.55 0 2.58 1.25 4.22 3.48 5.42L7.13 20.75h3.06l3.44-5.94h1.65v5.94h2.65V3.25H13.9Zm1.38 9.42h-1.46c-2.2 0-3.48-1.23-3.48-3.72 0-2.34 1.34-3.56 3.58-3.56h1.36v7.28Z"
            fill="currentColor"
          />
        </svg>
      </UiElement>
    );
  }

  return (
    <span
      aria-label="Google"
      className={`search-engine-logo google ${size}`}
      role="img"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M21.6 12.23c0-.72-.06-1.42-.18-2.09H12v3.95h5.39a4.61 4.61 0 0 1-2 3.03v2.56h3.24c1.9-1.75 2.97-4.32 2.97-7.45Z" fill="#4285F4" />
        <path d="M12 22c2.7 0 4.98-.9 6.63-2.32l-3.24-2.56c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.64A10 10 0 0 0 12 22Z" fill="#34A853" />
        <path d="M6.39 13.95A6.01 6.01 0 0 1 6.08 12c0-.68.12-1.34.31-1.95V7.41H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.59l3.35-2.64Z" fill="#FBBC05" />
        <path d="M12 5.92c1.47 0 2.79.51 3.82 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.41l3.35 2.64C7.18 7.68 9.39 5.92 12 5.92Z" fill="#EA4335" />
      </svg>
    </span>
  );
}
