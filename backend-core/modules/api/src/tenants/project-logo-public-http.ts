import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type Socket } from "node:net";

interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

type PublicHostResolver = (
  hostname: string,
  timeoutMs: number
) => Promise<readonly ResolvedAddress[]>;

export interface PublicLogoResource {
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly contentType?: string;
  readonly body: Buffer;
}

export class PublicLogoFetchError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_URL"
      | "FORBIDDEN_ADDRESS"
      | "DNS_FAILED"
      | "TIMEOUT"
      | "RESPONSE_TOO_LARGE"
      | "INVALID_REDIRECT"
      | "REDIRECT_LIMIT"
      | "UNSUPPORTED_ENCODING"
      | "NETWORK_ERROR"
  ) {
    super(code);
    this.name = "PublicLogoFetchError";
  }
}

export async function fetchPublicLogoResource(
  value: string,
  options: Readonly<{
    timeoutMs: number;
    maxBytes: number;
    accept: string;
    maxRedirects?: number;
  }>,
  resolver: PublicHostResolver = resolvePublicHost
): Promise<PublicLogoResource> {
  let current = assertSafePublicLogoUrl(value);
  const maxRedirects = options.maxRedirects ?? 3;

  for (let redirects = 0; ; redirects += 1) {
    const result = await requestPublicLogoResource(
      current,
      options,
      resolver
    );
    if (!isRedirect(result.statusCode)) {
      return {
        finalUrl: current.toString(),
        statusCode: result.statusCode,
        ...(result.contentType ? { contentType: result.contentType } : {}),
        body: result.body
      };
    }
    if (redirects >= maxRedirects) {
      throw new PublicLogoFetchError("REDIRECT_LIMIT");
    }
    if (!result.location) {
      throw new PublicLogoFetchError("INVALID_REDIRECT");
    }
    try {
      current = assertSafePublicLogoUrl(
        new URL(result.location, current).toString()
      );
    } catch (error) {
      if (error instanceof PublicLogoFetchError) throw error;
      throw new PublicLogoFetchError("INVALID_REDIRECT");
    }
  }
}

export function assertSafePublicLogoUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicLogoFetchError("INVALID_URL");
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
    throw new PublicLogoFetchError("INVALID_URL");
  }
  const hostname = stripIpv6Brackets(
    url.hostname.toLowerCase().replace(/\.$/u, "")
  );
  if (
    !hostname ||
    ["localhost", "local", "internal", "invalid", "test", "example"].some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    )
  ) {
    throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
  }
  if (isIP(hostname) !== 0) assertPublicAddress(hostname);
  url.hostname = hostname;
  return url;
}

export function isPublicLogoAddress(address: string): boolean {
  try {
    assertPublicAddress(address);
    return true;
  } catch {
    return false;
  }
}

async function requestPublicLogoResource(
  url: URL,
  options: Readonly<{
    timeoutMs: number;
    maxBytes: number;
    accept: string;
  }>,
  resolver: PublicHostResolver
): Promise<{
  readonly statusCode: number;
  readonly contentType?: string;
  readonly location?: string;
  readonly body: Buffer;
}> {
  const addresses = await resolver(url.hostname, options.timeoutMs);
  if (addresses.length === 0) throw new PublicLogoFetchError("DNS_FAILED");
  for (const { address } of addresses) assertPublicAddress(address);
  const candidates = uniqueAddresses(addresses)
    .sort((left, right) => left.family - right.family)
    .slice(0, 3);
  const deadline = performance.now() + options.timeoutMs;
  let lastError: PublicLogoFetchError | undefined;

  for (let index = 0; index < candidates.length; index += 1) {
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs < 1) break;
    try {
      return await requestResolvedAddress(
        url,
        options,
        candidates[index]!,
        remainingMs
      );
    } catch (error) {
      if (
        !(error instanceof PublicLogoFetchError) ||
        !["NETWORK_ERROR", "TIMEOUT"].includes(error.code)
      ) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError ?? new PublicLogoFetchError("TIMEOUT");
}

function requestResolvedAddress(
  url: URL,
  options: Readonly<{
    maxBytes: number;
    accept: string;
  }>,
  selected: ResolvedAddress,
  timeoutMs: number
): Promise<{
  readonly statusCode: number;
  readonly contentType?: string;
  readonly location?: string;
  readonly body: Buffer;
}> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: PublicLogoFetchError): void => {
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
          "User-Agent": "SeonoritaProjectIcon/1.0"
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const contentType = mediaType(response.headers["content-type"]);
        const location = singleHeader(response.headers.location);
        if (isRedirect(statusCode)) {
          response.destroy();
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          resolve({
            statusCode,
            ...(location ? { location } : {}),
            body: Buffer.alloc(0)
          });
          return;
        }
        const encoding = singleHeader(response.headers["content-encoding"]);
        if (encoding && encoding.toLowerCase() !== "identity") {
          response.destroy();
          fail(new PublicLogoFetchError("UNSUPPORTED_ENCODING"));
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
          fail(new PublicLogoFetchError("RESPONSE_TOO_LARGE"));
          return;
        }
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.byteLength;
          if (totalBytes > options.maxBytes) {
            response.destroy();
            fail(new PublicLogoFetchError("RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(buffer);
        });
        response.once("error", () =>
          fail(new PublicLogoFetchError("NETWORK_ERROR"))
        );
        response.once("end", () => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          resolve({
            statusCode,
            ...(contentType ? { contentType } : {}),
            body: Buffer.concat(chunks, totalBytes)
          });
        });
      }
    );
    timeout = setTimeout(() => {
      timedOut = true;
      request.destroy();
      fail(new PublicLogoFetchError("TIMEOUT"));
    }, Math.max(1, timeoutMs));
    timeout.unref();
    request.once("socket", (socket: Socket) => {
      socket.on("error", () => undefined);
      socket.once("connect", () => {
        if (!socket.remoteAddress || !isPublicLogoAddress(socket.remoteAddress)) {
          request.destroy();
          fail(new PublicLogoFetchError("FORBIDDEN_ADDRESS"));
        }
      });
    });
    request.once("error", () =>
      fail(
        new PublicLogoFetchError(timedOut ? "TIMEOUT" : "NETWORK_ERROR")
      )
    );
    request.end();
  });
}

async function resolvePublicHost(
  hostname: string,
  timeoutMs: number
): Promise<readonly ResolvedAddress[]> {
  const literal = stripIpv6Brackets(hostname);
  const family = isIP(literal);
  if (family === 4 || family === 6) {
    return [{ address: literal, family }];
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      dnsLookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new PublicLogoFetchError("TIMEOUT")),
          Math.max(1, timeoutMs)
        );
        timeout.unref();
      })
    ]);
    if (addresses.length === 0) throw new PublicLogoFetchError("DNS_FAILED");
    return addresses.map(({ address, family: addressFamily }) => ({
      address,
      family: addressFamily === 6 ? 6 : 4
    }));
  } catch (error) {
    if (error instanceof PublicLogoFetchError) throw error;
    throw new PublicLogoFetchError("DNS_FAILED");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function uniqueAddresses(
  addresses: readonly ResolvedAddress[]
): ResolvedAddress[] {
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
      throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
    }
    const value =
      (((parts[0]! << 24) >>> 0) +
        (parts[1]! << 16) +
        (parts[2]! << 8) +
        parts[3]!) >>>
      0;
    if (
      [
        ["0.0.0.0", 8],
        ["10.0.0.0", 8],
        ["100.64.0.0", 10],
        ["127.0.0.0", 8],
        ["169.254.0.0", 16],
        ["172.16.0.0", 12],
        ["192.0.0.0", 24],
        ["192.0.2.0", 24],
        ["192.168.0.0", 16],
        ["198.18.0.0", 15],
        ["198.51.100.0", 24],
        ["203.0.113.0", 24],
        ["224.0.0.0", 4],
        ["240.0.0.0", 4]
      ].some(([base, bits]) => inIpv4Range(value, String(base), Number(bits)))
    ) {
      throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
    }
    return;
  }
  if (family === 6) {
    const groups = ipv6Groups(address);
    const first = groups[0]!;
    const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
    const documentation = first === 0x2001 && groups[1] === 0x0db8;
    const orchidOrTeredo =
      first === 0x2001 &&
      (groups[1] === 0x0000 ||
        (groups[1]! >= 0x0010 && groups[1]! <= 0x002f));
    if (!isGlobalUnicast || documentation || orchidOrTeredo) {
      throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
    }
    return;
  }
  throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
}

function ipv6Groups(address: string): readonly number[] {
  const source = address.toLowerCase();
  if (source.includes("%")) throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
  const halves = source.split("::");
  if (halves.length > 2) throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
  const left = ipv6Part(halves[0] ?? "");
  const right = ipv6Part(halves[1] ?? "");
  const omitted = 8 - left.length - right.length;
  if (
    omitted < 0 ||
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  ) {
    throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
  }
  return [...left, ...Array<number>(omitted).fill(0), ...right];
}

function ipv6Part(value: string): readonly number[] {
  if (!value) return [];
  const result: number[] = [];
  for (const part of value.split(":")) {
    if (part.includes(".")) {
      const ipv4 = part.split(".").map(Number);
      if (
        ipv4.length !== 4 ||
        ipv4.some(
          (item) => !Number.isInteger(item) || item < 0 || item > 255
        )
      ) {
        throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
      }
      result.push((ipv4[0]! << 8) | ipv4[1]!);
      result.push((ipv4[2]! << 8) | ipv4[3]!);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/u.test(part)) {
      throw new PublicLogoFetchError("FORBIDDEN_ADDRESS");
    }
    result.push(Number.parseInt(part, 16));
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

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
}

function isRedirect(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" && value.length <= 2_048 ? value : undefined;
}

function mediaType(value: string | readonly string[] | undefined): string | undefined {
  const header = singleHeader(value);
  return header?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
}
