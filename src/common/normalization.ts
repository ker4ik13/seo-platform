import { randomBytes } from "node:crypto";
import { validationError } from "./domain-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function normalizeEmail(value: string): string {
  const email = value.normalize("NFKC").trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw validationError("email", "INVALID_EMAIL", "Enter a valid email");
  }
  return email;
}

export function normalizeCountry(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const country = value.toUpperCase();
  if (!/^[A-Z]{2}$/u.test(country)) {
    throw validationError(
      "country",
      "INVALID_COUNTRY",
      "Use a two-letter ISO country code"
    );
  }
  return country;
}

export function normalizeLocale(value: string | undefined): string {
  if (!value) return "en";
  try {
    return Intl.getCanonicalLocales(value)[0] ?? "en";
  } catch {
    throw validationError("locale", "INVALID_LOCALE", "Use a valid locale");
  }
}

export function normalizeTimezone(value: string | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    throw validationError(
      "timezone",
      "INVALID_TIMEZONE",
      "Use a valid IANA timezone"
    );
  }
}

export function normalizeSlug(value: string, path = "slug"): string {
  const slug = value.trim().toLowerCase();
  if (slug.length > 100 || !SLUG_PATTERN.test(slug)) {
    throw validationError(
      path,
      "INVALID_SLUG",
      "Use lowercase Latin letters, digits and single hyphens"
    );
  }
  return slug;
}

export function generatedSlug(name: string, fallback: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 86);
  const suffix = randomBytes(4).toString("hex");
  return `${base || fallback}-${suffix}`;
}

export function normalizeDomain(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw validationError("domain", "INVALID_DOMAIN", "Enter a valid domain");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw validationError(
      "domain",
      "INVALID_DOMAIN",
      "Enter a hostname without path, query, credentials or port"
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!hostname.includes(".") || hostname.length > 255) {
    throw validationError("domain", "INVALID_DOMAIN", "Enter a valid domain");
  }
  return hostname;
}
