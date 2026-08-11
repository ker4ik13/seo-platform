import type { ProjectLogoContentType } from "@seo-platform/contracts";
import {
  detectedProjectLogoContentType,
  PROJECT_LOGO_MAX_BYTES
} from "./project-logo-image.js";
import { fetchPublicLogoResource } from "./project-logo-public-http.js";

const HTML_MAX_BYTES = 512 * 1_024;
const MANIFEST_MAX_BYTES = 128 * 1_024;
const MAX_CANDIDATES = 12;
const CANDIDATE_BATCH_SIZE = 4;

interface LogoCandidate {
  readonly url: string;
  readonly declaredPixels: number;
  readonly vectorHint: boolean;
  readonly priority: number;
}

export interface DiscoveredProjectLogo {
  readonly contentType: ProjectLogoContentType;
  readonly data: Buffer;
  readonly sourceUrl: string;
}

export async function discoverProjectLogo(
  domain: string
): Promise<DiscoveredProjectLogo | undefined> {
  const roots = [`https://${domain}/`, `http://${domain}/`];
  const candidates: LogoCandidate[] = [];
  let homepageUrl: string | undefined;
  let homepageHtml: string | undefined;

  for (const root of roots) {
    const homepage = await fetchedText(root, HTML_MAX_BYTES, 1_800, [
      "text/html",
      "application/xhtml+xml"
    ]);
    if (!homepage) continue;
    homepageUrl = homepage.finalUrl;
    homepageHtml = homepage.text;
    break;
  }

  if (homepageUrl && homepageHtml) {
    candidates.push(...htmlIconCandidates(homepageHtml, homepageUrl));
    const manifestUrls = htmlManifestUrls(homepageHtml, homepageUrl).slice(0, 2);
    const manifests = await Promise.all(
      manifestUrls.map((url) => manifestIconCandidates(url))
    );
    for (const manifestCandidates of manifests) {
      candidates.push(...manifestCandidates);
    }
    candidates.push(...standardIconCandidates(new URL(homepageUrl).origin));
  }
  for (const root of roots) {
    candidates.push(...standardIconCandidates(new URL(root).origin));
  }

  const ranked = uniqueCandidates(candidates)
    .sort((left, right) => estimatedScore(right) - estimatedScore(left))
    .slice(0, MAX_CANDIDATES);
  for (let index = 0; index < ranked.length; index += CANDIDATE_BATCH_SIZE) {
    const batch = ranked.slice(index, index + CANDIDATE_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (candidate) => {
        const image = await fetchedImage(candidate);
        return image ? { candidate, image } : undefined;
      })
    );
    const available = results
      .filter((result): result is NonNullable<typeof result> => Boolean(result))
      .sort(
        (left, right) =>
          actualScore(right.candidate, right.image) -
          actualScore(left.candidate, left.image)
      );
    if (available[0]) return available[0].image;
  }
  return undefined;
}

export function htmlIconCandidates(
  html: string,
  baseUrl: string
): readonly LogoCandidate[] {
  const result: LogoCandidate[] = [];
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    const attributes = htmlAttributes(tag);
    const rel = (attributes.get("rel") ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean);
    if (
      !rel.includes("icon") &&
      !rel.some((value) => value.startsWith("apple-touch-icon")) &&
      !rel.includes("mask-icon")
    ) {
      continue;
    }
    const href = attributes.get("href");
    const url = href ? resolvedHttpUrl(href, baseUrl) : undefined;
    if (!url) continue;
    const type = (attributes.get("type") ?? "").toLowerCase();
    const sizes = attributes.get("sizes") ?? "";
    result.push({
      url,
      declaredPixels: declaredIconPixels(sizes),
      vectorHint:
        type === "image/svg+xml" ||
        /\.svg(?:$|[?#])/iu.test(url) ||
        sizes.toLowerCase().split(/\s+/u).includes("any"),
      priority: rel.some((value) => value.startsWith("apple-touch-icon"))
        ? 80
        : rel.includes("icon")
          ? 100
          : 60
    });
  }
  return result;
}

function htmlManifestUrls(html: string, baseUrl: string): readonly string[] {
  const result: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    const attributes = htmlAttributes(tag);
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/u);
    if (!rel.includes("manifest")) continue;
    const href = attributes.get("href");
    const url = href ? resolvedHttpUrl(href, baseUrl) : undefined;
    if (url) result.push(url);
  }
  return [...new Set(result)];
}

async function manifestIconCandidates(
  manifestUrl: string
): Promise<readonly LogoCandidate[]> {
  const manifest = await fetchedText(manifestUrl, MANIFEST_MAX_BYTES, 1_200, [
    "application/manifest+json",
    "application/json",
    "text/plain"
  ]);
  if (!manifest) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(manifest.text);
  } catch {
    return [];
  }
  if (!isRecord(payload) || !Array.isArray(payload.icons)) return [];
  const result: LogoCandidate[] = [];
  for (const icon of payload.icons.slice(0, 24)) {
    if (!isRecord(icon) || typeof icon.src !== "string") continue;
    const url = resolvedHttpUrl(icon.src, manifest.finalUrl);
    if (!url) continue;
    const type = typeof icon.type === "string" ? icon.type.toLowerCase() : "";
    const sizes = typeof icon.sizes === "string" ? icon.sizes : "";
    result.push({
      url,
      declaredPixels: declaredIconPixels(sizes),
      vectorHint:
        type === "image/svg+xml" ||
        /\.svg(?:$|[?#])/iu.test(url) ||
        sizes.toLowerCase().split(/\s+/u).includes("any"),
      priority: 90
    });
  }
  return result;
}

function standardIconCandidates(origin: string): readonly LogoCandidate[] {
  return [
    ["/favicon.svg", 0, true, 70],
    ["/favicon-512x512.png", 512 * 512, false, 65],
    ["/android-chrome-512x512.png", 512 * 512, false, 65],
    ["/apple-touch-icon.png", 180 * 180, false, 60],
    ["/favicon-192x192.png", 192 * 192, false, 55],
    ["/android-chrome-192x192.png", 192 * 192, false, 55],
    ["/favicon.png", 0, false, 45],
    ["/favicon.ico", 0, false, 40]
  ].map(([path, declaredPixels, vectorHint, priority]) => ({
    url: new URL(String(path), origin).toString(),
    declaredPixels: Number(declaredPixels),
    vectorHint: Boolean(vectorHint),
    priority: Number(priority)
  }));
}

async function fetchedImage(
  candidate: LogoCandidate
): Promise<DiscoveredProjectLogo | undefined> {
  try {
    const response = await fetchPublicLogoResource(candidate.url, {
      timeoutMs: 1_200,
      maxBytes: PROJECT_LOGO_MAX_BYTES,
      maxRedirects: 3,
      accept: "image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.2"
    });
    if (
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      response.body.byteLength < 32
    ) {
      return undefined;
    }
    const contentType = detectedProjectLogoContentType(response.body);
    if (!contentType) return undefined;
    return {
      contentType,
      data: response.body,
      sourceUrl: response.finalUrl
    };
  } catch {
    return undefined;
  }
}

async function fetchedText(
  url: string,
  maxBytes: number,
  timeoutMs: number,
  acceptedContentTypes: readonly string[]
): Promise<
  | Readonly<{ finalUrl: string; text: string }>
  | undefined
> {
  try {
    const response = await fetchPublicLogoResource(url, {
      timeoutMs,
      maxBytes,
      maxRedirects: 3,
      accept: acceptedContentTypes.join(",")
    });
    if (response.statusCode < 200 || response.statusCode >= 300) return undefined;
    if (
      response.contentType &&
      !acceptedContentTypes.includes(response.contentType)
    ) {
      return undefined;
    }
    const text = response.body.toString("utf8");
    if (text.includes("\uFFFD")) return undefined;
    return { finalUrl: response.finalUrl, text };
  } catch {
    return undefined;
  }
}

function htmlAttributes(tag: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const source = tag.replace(/^<link\b/iu, "").replace(/>$/u, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1]?.toLowerCase();
    if (!name || result.has(name)) continue;
    result.set(name, htmlEntityValue(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return result;
}

function htmlEntityValue(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, number: string) =>
      String.fromCodePoint(Number(number))
    )
    .replace(/&#x([0-9a-f]+);/giu, (_match, number: string) =>
      String.fromCodePoint(Number.parseInt(number, 16))
    );
}

function resolvedHttpUrl(value: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(value.trim(), baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function declaredIconPixels(value: string): number {
  let largest = 0;
  for (const token of value.toLowerCase().split(/\s+/u)) {
    const match = /^(\d{1,5})x(\d{1,5})$/u.exec(token);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width <= 4096 && height <= 4096) {
      largest = Math.max(largest, width * height);
    }
  }
  return largest;
}

function uniqueCandidates(candidates: readonly LogoCandidate[]): LogoCandidate[] {
  const byUrl = new Map<string, LogoCandidate>();
  for (const candidate of candidates) {
    const current = byUrl.get(candidate.url);
    if (!current || estimatedScore(candidate) > estimatedScore(current)) {
      byUrl.set(candidate.url, candidate);
    }
  }
  return [...byUrl.values()];
}

function estimatedScore(candidate: LogoCandidate): number {
  return (
    (candidate.vectorHint ? 1_000_000_000_000 : 0) +
    candidate.declaredPixels * 1_000 +
    candidate.priority
  );
}

function actualScore(
  candidate: LogoCandidate,
  image: DiscoveredProjectLogo
): number {
  if (image.contentType === "image/svg+xml") return Number.MAX_SAFE_INTEGER;
  const pixels = imagePixels(image.contentType, image.data) || candidate.declaredPixels;
  return pixels * 1_000 + formatPreference(image.contentType) + candidate.priority;
}

function imagePixels(type: ProjectLogoContentType, data: Buffer): number {
  if (type === "image/png" && data.byteLength >= 24) {
    return boundedPixels(data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if (type === "image/gif" && data.byteLength >= 10) {
    return boundedPixels(data.readUInt16LE(6), data.readUInt16LE(8));
  }
  if (type === "image/x-icon" && data.byteLength >= 6) {
    const count = Math.min(data.readUInt16LE(4), 128);
    let largest = 0;
    for (let index = 0; index < count; index += 1) {
      const offset = 6 + index * 16;
      if (offset + 16 > data.byteLength) break;
      largest = Math.max(
        largest,
        boundedPixels(data[offset] || 256, data[offset + 1] || 256)
      );
    }
    return largest;
  }
  if (
    type === "image/webp" &&
    data.byteLength >= 30 &&
    data.subarray(12, 16).toString("ascii") === "VP8X"
  ) {
    return boundedPixels(
      1 + data.readUIntLE(24, 3),
      1 + data.readUIntLE(27, 3)
    );
  }
  if (type === "image/jpeg") return jpegPixels(data);
  return 0;
}

function jpegPixels(data: Buffer): number {
  let offset = 2;
  while (offset + 9 < data.byteLength) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1]!;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return boundedPixels(data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5));
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += length + 2;
  }
  return 0;
}

function boundedPixels(width: number, height: number): number {
  return width > 0 && height > 0 && width <= 16_384 && height <= 16_384
    ? width * height
    : 0;
}

function formatPreference(type: ProjectLogoContentType): number {
  return {
    "image/svg+xml": 700,
    "image/avif": 600,
    "image/png": 500,
    "image/webp": 400,
    "image/x-icon": 300,
    "image/jpeg": 200,
    "image/gif": 100
  }[type];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
