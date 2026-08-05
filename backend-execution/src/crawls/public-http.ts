import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type Socket } from "node:net";

export const CRAWL_USER_AGENT = "SeoPlatformCrawler/1.0";

export interface PublicFetchOptions {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
  readonly accept: string;
  readonly allowedContentTypes: readonly string[];
  readonly acceptAnyContentType?: boolean;
  readonly userAgent?: string;
  readonly beforeRequest?: () => Promise<void>;
  readonly conditional?: {
    readonly etag?: string;
    readonly lastModified?: string;
  };
}

export interface PublicFetchResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly contentType?: string;
  readonly body: Buffer;
  readonly sizeBytes: number;
  readonly responseTimeMs: number;
  readonly redirectChain: readonly string[];
  readonly etag?: string;
  readonly lastModified?: string;
  readonly retryAfterMs?: number;
}

export class PublicFetchError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_URL"
      | "INVALID_REQUEST_HEADER"
      | "INVALID_NOT_MODIFIED"
      | "FORBIDDEN_ADDRESS"
      | "DNS_FAILED"
      | "TIMEOUT"
      | "RESPONSE_TOO_LARGE"
      | "REDIRECT_LIMIT"
      | "INVALID_REDIRECT"
      | "UNSUPPORTED_CONTENT_TYPE"
      | "UNSUPPORTED_CONTENT_ENCODING"
      | "NETWORK_ERROR"
  ) {
    super(code);
    this.name = "PublicFetchError";
  }
}

interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

type Resolver = (
  hostname: string
) => Promise<readonly ResolvedAddress[]>;

export function assertSafeCrawlUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicFetchError("INVALID_URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port &&
      !(
        (url.protocol === "http:" && url.port === "80") ||
        (url.protocol === "https:" && url.port === "443")
      ))
  ) {
    throw new PublicFetchError("INVALID_URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new PublicFetchError("FORBIDDEN_ADDRESS");
  }
  if (isIP(stripIpv6Brackets(hostname)) > 0) {
    assertPublicAddress(stripIpv6Brackets(hostname));
  }
  url.hostname = hostname;
  return url;
}

export function isPublicAddress(address: string): boolean {
  try {
    assertPublicAddress(address);
    return true;
  } catch {
    return false;
  }
}

export async function fetchPublicResource(
  value: string,
  options: PublicFetchOptions,
  resolver: Resolver = resolveHost
): Promise<PublicFetchResult> {
  const requested = assertSafeCrawlUrl(value);
  let current = requested;
  const redirects: string[] = [];
  const startedAt = performance.now();
  let pacingTimeMs = 0;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const pacingStartedAt = performance.now();
    await options.beforeRequest?.();
    pacingTimeMs += performance.now() - pacingStartedAt;
    const result = await requestOnce(
      current,
      options,
      resolver,
      redirectCount === 0
        ? conditionalRequestHeaders(options.conditional)
        : {}
    );
    if (!isRedirect(result.statusCode)) {
      return {
        requestedUrl: requested.toString(),
        finalUrl: current.toString(),
        statusCode: result.statusCode,
        ...(result.contentType ? { contentType: result.contentType } : {}),
        body: result.body,
        sizeBytes: result.body.byteLength,
        responseTimeMs: Math.max(
          0,
          Math.round(performance.now() - startedAt - pacingTimeMs)
        ),
        redirectChain: redirects,
        ...(result.etag ? { etag: result.etag } : {}),
        ...(result.lastModified ? { lastModified: result.lastModified } : {}),
        ...(result.retryAfterMs !== undefined
          ? { retryAfterMs: result.retryAfterMs }
          : {})
      };
    }
    if (redirectCount >= options.maxRedirects) {
      throw new PublicFetchError("REDIRECT_LIMIT");
    }
    if (!result.location) {
      throw new PublicFetchError("INVALID_REDIRECT");
    }
    let next: URL;
    try {
      next = assertSafeCrawlUrl(
        new URL(result.location, current).toString()
      );
    } catch (error) {
      if (error instanceof PublicFetchError) throw error;
      throw new PublicFetchError("INVALID_REDIRECT");
    }
    redirects.push(next.toString());
    current = next;
  }
}

async function resolveHost(hostname: string): Promise<readonly ResolvedAddress[]> {
  const literal = stripIpv6Brackets(hostname);
  const family = isIP(literal);
  if (family === 4 || family === 6) {
    return [{ address: literal, family }];
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = (await dnsLookup(hostname, {
      all: true,
      verbatim: true
    })) as readonly ResolvedAddress[];
  } catch {
    throw new PublicFetchError("DNS_FAILED");
  }
  if (addresses.length === 0) throw new PublicFetchError("DNS_FAILED");
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4
  }));
}

async function requestOnce(
  url: URL,
  options: PublicFetchOptions,
  resolver: Resolver,
  conditionalHeaders: Readonly<Record<string, string>>
): Promise<{
  readonly statusCode: number;
  readonly contentType?: string;
  readonly location?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly retryAfterMs?: number;
  readonly body: Buffer;
}> {
  const addresses = await resolver(url.hostname);
  if (addresses.length === 0) throw new PublicFetchError("DNS_FAILED");
  for (const { address } of addresses) assertPublicAddress(address);
  const candidates = [...uniqueAddresses(addresses)]
    .sort((left, right) => left.family - right.family)
    .slice(0, 4);
  const deadline = performance.now() + options.timeoutMs;
  let lastError: PublicFetchError | undefined;

  for (let index = 0; index < candidates.length; index += 1) {
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs < 1) break;
    const attemptTimeoutMs =
      index === candidates.length - 1
        ? remainingMs
        : Math.min(5_000, remainingMs);
    try {
      return await requestResolvedAddress(
        url,
        options,
        candidates[index]!,
        attemptTimeoutMs,
        conditionalHeaders
      );
    } catch (error) {
      if (
        !(error instanceof PublicFetchError) ||
        !["NETWORK_ERROR", "TIMEOUT"].includes(error.code)
      ) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new PublicFetchError("TIMEOUT");
}

function requestResolvedAddress(
  url: URL,
  options: PublicFetchOptions,
  selected: ResolvedAddress,
  timeoutMs: number,
  conditionalHeaders: Readonly<Record<string, string>>
): Promise<{
  readonly statusCode: number;
  readonly contentType?: string;
  readonly location?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly retryAfterMs?: number;
  readonly body: Buffer;
}> {
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const fail = (error: PublicFetchError): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    };
    const request = transport.request(
      {
        agent: false,
        protocol: url.protocol,
        hostname: selected.address,
        family: selected.family,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
        method: "GET",
        headers: {
          Accept: options.accept,
          "Accept-Encoding": "identity",
          Host: url.host,
          "User-Agent": options.userAgent ?? CRAWL_USER_AGENT,
          ...conditionalHeaders
        },
        setDefaultHeaders: true
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const contentType = mediaType(response.headers["content-type"]);
        const location = singleHeader(response.headers.location);
        const etag = boundedHeader(response.headers.etag);
        const lastModified = boundedHeader(
          response.headers["last-modified"]
        );
        const retryAfterMs = retryAfterDelay(
          response.headers["retry-after"]
        );
        const contentEncoding = singleHeader(
          response.headers["content-encoding"]
        );
        if (
          contentEncoding &&
          contentEncoding.toLowerCase() !== "identity" &&
          !isRedirect(statusCode) &&
          statusCode !== 304
        ) {
          response.destroy();
          fail(new PublicFetchError("UNSUPPORTED_CONTENT_ENCODING"));
          return;
        }
        const advertisedLength = Number(
          singleHeader(response.headers["content-length"]) ?? "0"
        );
        if (
          Number.isFinite(advertisedLength) &&
          advertisedLength > options.maxBytes
        ) {
          response.destroy();
          fail(new PublicFetchError("RESPONSE_TOO_LARGE"));
          return;
        }
        if (
          !isRedirect(statusCode) &&
          statusCode !== 304 &&
          contentType &&
          !options.acceptAnyContentType &&
          !options.allowedContentTypes.includes(contentType)
        ) {
          response.destroy();
          fail(new PublicFetchError("UNSUPPORTED_CONTENT_TYPE"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > options.maxBytes) {
            response.destroy();
            fail(new PublicFetchError("RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(buffer);
        });
        response.once("end", () => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          resolve({
            statusCode,
            ...(contentType ? { contentType } : {}),
            ...(location ? { location } : {}),
            ...(etag ? { etag } : {}),
            ...(lastModified ? { lastModified } : {}),
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            body: Buffer.concat(chunks, bytes)
          });
        });
        response.once("error", () =>
          fail(new PublicFetchError("NETWORK_ERROR"))
        );
      }
    );
    timeout = setTimeout(() => {
      timedOut = true;
      request.destroy();
      fail(new PublicFetchError("TIMEOUT"));
    }, timeoutMs);
    timeout.unref();
    request.once("socket", (socket: Socket) => {
      socket.on("error", () => undefined);
      socket.once("connect", () => {
        if (
          !socket.remoteAddress ||
          !isPublicAddress(socket.remoteAddress)
        ) {
          request.destroy();
          fail(new PublicFetchError("FORBIDDEN_ADDRESS"));
        }
      });
    });
    request.once("error", () => {
      if (timedOut) {
        fail(new PublicFetchError("TIMEOUT"));
      } else {
        fail(new PublicFetchError("NETWORK_ERROR"));
      }
    });
    request.end();
  });
}

function uniqueAddresses(
  addresses: readonly ResolvedAddress[]
): readonly ResolvedAddress[] {
  const seen = new Set<string>();
  return addresses.filter(({ address, family }) => {
    const key = `${family}:${address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) {
      throw new PublicFetchError("FORBIDDEN_ADDRESS");
    }
    const value =
      (((parts[0]! << 24) >>> 0) +
        (parts[1]! << 16) +
        (parts[2]! << 8) +
        parts[3]!) >>>
      0;
    if (
      inIpv4Range(value, "0.0.0.0", 8) ||
      inIpv4Range(value, "10.0.0.0", 8) ||
      inIpv4Range(value, "100.64.0.0", 10) ||
      inIpv4Range(value, "127.0.0.0", 8) ||
      inIpv4Range(value, "169.254.0.0", 16) ||
      inIpv4Range(value, "172.16.0.0", 12) ||
      inIpv4Range(value, "192.0.0.0", 24) ||
      inIpv4Range(value, "192.0.2.0", 24) ||
      inIpv4Range(value, "192.168.0.0", 16) ||
      inIpv4Range(value, "198.18.0.0", 15) ||
      inIpv4Range(value, "198.51.100.0", 24) ||
      inIpv4Range(value, "203.0.113.0", 24) ||
      inIpv4Range(value, "224.0.0.0", 4) ||
      inIpv4Range(value, "240.0.0.0", 4)
    ) {
      throw new PublicFetchError("FORBIDDEN_ADDRESS");
    }
    return;
  }
  if (family === 6) {
    const groups = ipv6Groups(address);
    const first = groups[0]!;
    const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
    const documentation =
      first === 0x2001 && groups[1] === 0x0db8;
    const orchidOrTeredo =
      first === 0x2001 &&
      (groups[1] === 0x0000 ||
        (groups[1]! >= 0x0010 && groups[1]! <= 0x002f));
    if (!isGlobalUnicast || documentation || orchidOrTeredo) {
      throw new PublicFetchError("FORBIDDEN_ADDRESS");
    }
    return;
  }
  throw new PublicFetchError("FORBIDDEN_ADDRESS");
}

function ipv6Groups(address: string): readonly number[] {
  const source = address.toLowerCase();
  if (source.includes("%")) {
    throw new PublicFetchError("FORBIDDEN_ADDRESS");
  }
  const halves = source.split("::");
  if (halves.length > 2) throw new PublicFetchError("FORBIDDEN_ADDRESS");
  const left = ipv6Part(halves[0] ?? "");
  const right = ipv6Part(halves[1] ?? "");
  const omitted = 8 - left.length - right.length;
  if (
    omitted < 0 ||
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  ) {
    throw new PublicFetchError("FORBIDDEN_ADDRESS");
  }
  return [...left, ...Array<number>(omitted).fill(0), ...right];
}

function ipv6Part(value: string): readonly number[] {
  if (!value) return [];
  const parts = value.split(":");
  const result: number[] = [];
  for (const part of parts) {
    if (part.includes(".")) {
      const ipv4 = part.split(".").map(Number);
      if (
        ipv4.length !== 4 ||
        ipv4.some(
          (item) => !Number.isInteger(item) || item < 0 || item > 255
        )
      ) {
        throw new PublicFetchError("FORBIDDEN_ADDRESS");
      }
      result.push((ipv4[0]! << 8) | ipv4[1]!);
      result.push((ipv4[2]! << 8) | ipv4[3]!);
    } else {
      if (!/^[0-9a-f]{1,4}$/u.test(part)) {
        throw new PublicFetchError("FORBIDDEN_ADDRESS");
      }
      result.push(Number.parseInt(part, 16));
    }
  }
  return result;
}

function inIpv4Range(value: number, base: string, bits: number): boolean {
  const parts = base.split(".").map(Number);
  const baseValue =
    (((parts[0]! << 24) >>> 0) +
      (parts[1]! << 16) +
      (parts[2]! << 8) +
      parts[3]!) >>>
    0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function mediaType(value: string | string[] | undefined): string | undefined {
  const header = singleHeader(value);
  return header?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
}

function singleHeader(
  value: string | readonly string[] | undefined
): string | undefined {
  if (typeof value === "string") return value;
  return value?.length === 1 ? value[0] : undefined;
}

function boundedHeader(
  value: string | readonly string[] | undefined
): string | undefined {
  const header = singleHeader(value);
  return header &&
    header.length <= 1_000 &&
    /^[\u0020-\u007e]+$/u.test(header)
    ? header
    : undefined;
}

export function conditionalRequestHeaders(
  value:
    | {
        readonly etag?: string;
        readonly lastModified?: string;
      }
    | undefined
): Readonly<Record<string, string>> {
  if (!value) return {};
  const headers: Record<string, string> = {};
  if (value.etag !== undefined) {
    if (!safeRequestHeader(value.etag, 1_000)) {
      throw new PublicFetchError("INVALID_REQUEST_HEADER");
    }
    headers["If-None-Match"] = value.etag;
  }
  if (value.lastModified !== undefined) {
    if (!safeRequestHeader(value.lastModified, 128)) {
      throw new PublicFetchError("INVALID_REQUEST_HEADER");
    }
    headers["If-Modified-Since"] = value.lastModified;
  }
  return headers;
}

function safeRequestHeader(value: string, max: number): boolean {
  return (
    value.length >= 1 &&
    value.length <= max &&
    /^[\u0020-\u007e]+$/u.test(value)
  );
}

export function retryAfterDelay(
  value: string | readonly string[] | undefined,
  nowMs = Date.now()
): number | undefined {
  const header = singleHeader(value);
  if (
    !header ||
    header.length > 128 ||
    !/^[\u0020-\u007e]+$/u.test(header)
  ) {
    return undefined;
  }
  if (/^(?:0|[1-9]\d{0,9})$/u.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds * 1_000 : undefined;
  }
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
      header
    )
  ) {
    return undefined;
  }
  const timestamp = Date.parse(header);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - nowMs);
}

function isRedirect(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
}
