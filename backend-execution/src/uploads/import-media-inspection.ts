import type { SupportedImportMediaType } from "@seo-platform/contracts";

export interface ImportMediaInspection {
  readonly accepted: boolean;
  readonly detectedMediaType: string;
  readonly rejectionCode?: string;
}

const OLE_COMPOUND = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1
]);
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08])
];
const FORBIDDEN_SIGNATURES = [
  Buffer.from([0x4d, 0x5a]),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from("%PDF-", "ascii"),
  Buffer.from([0x52, 0x61, 0x72, 0x21]),
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  Buffer.from([0x1f, 0x8b])
];

export function inspectImportMedia(
  sample: Uint8Array,
  declaredMediaType: SupportedImportMediaType
): ImportMediaInspection {
  const value = Buffer.from(sample);
  if (FORBIDDEN_SIGNATURES.some((signature) => startsWith(value, signature))) {
    return rejected("application/octet-stream", "FORBIDDEN_FILE_SIGNATURE");
  }

  if (declaredMediaType === "application/vnd.ms-excel") {
    return startsWith(value, OLE_COMPOUND)
      ? accepted("application/vnd.ms-excel")
      : rejected("application/octet-stream", "MIME_SIGNATURE_MISMATCH");
  }
  if (
    declaredMediaType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    declaredMediaType === "application/vnd.key-collector.project" ||
    declaredMediaType === "application/zip"
  ) {
    return ZIP_SIGNATURES.some((signature) => startsWith(value, signature))
      ? accepted("application/zip")
      : rejected("application/octet-stream", "MIME_SIGNATURE_MISMATCH");
  }

  if (!looksLikeText(value)) {
    return rejected("application/octet-stream", "BINARY_TEXT_FILE");
  }
  return accepted(declaredMediaType);
}

function looksLikeText(value: Buffer): boolean {
  if (value.includes(0)) return false;
  if (value.length === 0) return true;
  let controlBytes = 0;
  for (const byte of value) {
    if (
      (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) ||
      byte === 0x7f
    ) {
      controlBytes += 1;
    }
  }
  return controlBytes / value.length <= 0.01;
}

function startsWith(value: Buffer, signature: Buffer): boolean {
  return (
    value.length >= signature.length &&
    value.subarray(0, signature.length).equals(signature)
  );
}

function accepted(detectedMediaType: string): ImportMediaInspection {
  return { accepted: true, detectedMediaType };
}

function rejected(
  detectedMediaType: string,
  rejectionCode: string
): ImportMediaInspection {
  return { accepted: false, detectedMediaType, rejectionCode };
}
