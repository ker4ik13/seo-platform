import type { ProjectLogoContentType } from "@seo-platform/contracts";

export const PROJECT_LOGO_MAX_BYTES = 512 * 1_024;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

export function detectedProjectLogoContentType(
  data: Buffer
): ProjectLogoContentType | undefined {
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    data[0] === 0x00 &&
    data[1] === 0x00 &&
    data[2] === 0x01 &&
    data[3] === 0x00
  ) {
    return "image/x-icon";
  }
  const gifSignature = data.subarray(0, 6).toString("ascii");
  if (gifSignature === "GIF87a" || gifSignature === "GIF89a") {
    return "image/gif";
  }
  if (
    data.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["avif", "avis"].includes(data.subarray(8, 12).toString("ascii"))
  ) {
    return "image/avif";
  }
  return safeSvg(data) ? "image/svg+xml" : undefined;
}

function safeSvg(data: Buffer): boolean {
  if (data.byteLength < 32 || data.includes(0)) return false;
  const source = data.toString("utf8").replace(/^\uFEFF/u, "").trim();
  if (source.includes("\uFFFD") || !/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/iu.test(source)) {
    return false;
  }
  return ![
    /<!DOCTYPE\b/iu,
    /<!ENTITY\b/iu,
    /<(?:script|foreignObject|iframe|object|embed)\b/iu,
    /\son[a-z]+\s*=/iu,
    /(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:|data:text\/html)/iu,
    /url\s*\(\s*["']?\s*(?:https?:|\/\/|javascript:)/iu
  ].some((pattern) => pattern.test(source));
}
