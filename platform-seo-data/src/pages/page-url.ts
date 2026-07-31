import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";

export interface NormalizedPageUrl {
  readonly original: string;
  readonly normalized: string;
  readonly hash: string;
}

export function normalizePageUrl(
  value: string,
  field = "url"
): NormalizedPageUrl {
  const source = value.trim();
  if (!source || source.length > 4_096) invalid(field);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    invalid(field);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    invalid(field);
  }
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  const normalized = url.toString();
  if (normalized.length > 4_096) invalid(field);
  return {
    original: source,
    normalized,
    hash: createHash("sha256").update(normalized, "utf8").digest("hex")
  };
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid page field: ${field}`);
}
