import { gunzip } from "node:zlib";
import { SaxesParser, type SaxesTagPlain } from "saxes";

export interface SitemapDocument {
  readonly pageUrls: readonly string[];
  readonly sitemapUrls: readonly string[];
}

export class SitemapParseError extends Error {
  public constructor() {
    super("INVALID_SITEMAP");
    this.name = "SitemapParseError";
  }
}

export async function sitemapBodyText(
  body: Buffer,
  maxBytes: number
): Promise<string> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 5_000_000 ||
    body.byteLength > maxBytes
  ) {
    throw new SitemapParseError();
  }
  if (body[0] !== 0x1f || body[1] !== 0x8b) {
    return body.toString("utf8");
  }
  const decompressed = await new Promise<Buffer>((resolve, reject) => {
    gunzip(body, { maxOutputLength: maxBytes }, (error, result) => {
      if (error) {
        reject(new SitemapParseError());
        return;
      }
      resolve(result);
    });
  });
  return decompressed.toString("utf8");
}

export function parseSitemapXml(
  xml: string,
  maxLocations: number
): SitemapDocument {
  if (
    !Number.isSafeInteger(maxLocations) ||
    maxLocations < 1 ||
    maxLocations > 1_000
  ) {
    throw new TypeError("Invalid sitemap location limit");
  }
  let root: "urlset" | "sitemapindex" | undefined;
  const stack: string[] = [];
  const pageUrls: string[] = [];
  const sitemapUrls: string[] = [];
  let locations = 0;
  let locationText: string | undefined;
  let locationParent: string | undefined;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", invalid);
  parser.on("opentag", (tag: SaxesTagPlain) => {
    const name = localName(tag.name);
    stack.push(name);
    if (stack.length > 16) invalid();
    if (stack.length === 1) {
      if (name !== "urlset" && name !== "sitemapindex") invalid();
      root = name;
    }
    if (name === "loc") {
      locationParent = stack.at(-2);
      if (
        (root === "urlset" && locationParent !== "url") ||
        (root === "sitemapindex" && locationParent !== "sitemap")
      ) {
        invalid();
      }
      locationText = "";
    }
  });
  parser.on("text", (text: string) => {
    if (locationText === undefined) return;
    locationText += text;
    if (locationText.length > 4_096) invalid();
  });
  parser.on("cdata", (text: string) => {
    if (locationText === undefined) return;
    locationText += text;
    if (locationText.length > 4_096) invalid();
  });
  parser.on("closetag", (tag: SaxesTagPlain) => {
    const name = localName(tag.name);
    if (stack.at(-1) !== name) invalid();
    if (name === "loc") {
      const location = locationText?.trim() ?? "";
      if (!location) invalid();
      locations += 1;
      if (locations <= maxLocations) {
        const target = locationParent === "url" ? pageUrls : sitemapUrls;
        target.push(location);
      }
      locationText = undefined;
      locationParent = undefined;
    }
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch {
    throw new SitemapParseError();
  }
  if (
    !root ||
    stack.length !== 0 ||
    (root === "urlset" && sitemapUrls.length > 0) ||
    (root === "sitemapindex" && pageUrls.length > 0)
  ) {
    invalid();
  }
  return { pageUrls, sitemapUrls };
}

function localName(value: string): string {
  return value.slice(value.lastIndexOf(":") + 1).toLowerCase();
}

function invalid(): never {
  throw new SitemapParseError();
}
