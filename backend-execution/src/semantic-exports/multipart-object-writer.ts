import type {
  CompletedPart,
  ObjectStoragePort
} from "../storage/object-storage.port.js";

const PART_SIZE_BYTES = 8 * 1_024 * 1_024;
const UPLOAD_TIMEOUT_MS = 120_000;

export async function writeArtifact(
  storage: ObjectStoragePort,
  objectKey: string,
  contentType: string,
  source: AsyncIterable<Uint8Array>
): Promise<bigint> {
  const upload = await storage.createMultipartUpload(
    "artifacts",
    objectKey,
    contentType
  );
  const parts: CompletedPart[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let totalBytes = 0n;
  try {
    for await (const chunk of source) {
      if (chunk.byteLength === 0) continue;
      pending.push(chunk);
      pendingBytes += chunk.byteLength;
      totalBytes += BigInt(chunk.byteLength);
      while (pendingBytes >= PART_SIZE_BYTES) {
        const joined = concat(pending, pendingBytes);
        const part = joined.slice(0, PART_SIZE_BYTES);
        const remainder = joined.slice(PART_SIZE_BYTES);
        parts.push(await uploadPart(storage, objectKey, upload.uploadId, parts.length + 1, part));
        pending = remainder.byteLength > 0 ? [remainder] : [];
        pendingBytes = remainder.byteLength;
      }
    }
    if (pendingBytes > 0) {
      parts.push(await uploadPart(
        storage,
        objectKey,
        upload.uploadId,
        parts.length + 1,
        concat(pending, pendingBytes)
      ));
    }
    if (parts.length === 0) {
      parts.push(await uploadPart(storage, objectKey, upload.uploadId, 1, new Uint8Array([0])));
      totalBytes = 1n;
    }
    await storage.completeMultipartUpload("artifacts", objectKey, upload.uploadId, parts);
    return totalBytes;
  } catch (error) {
    await storage.abortMultipartUpload("artifacts", objectKey, upload.uploadId).catch(() => undefined);
    throw error;
  }
}

async function uploadPart(
  storage: ObjectStoragePort,
  objectKey: string,
  uploadId: string,
  partNumber: number,
  body: Uint8Array
): Promise<CompletedPart> {
  const url = await storage.createUploadPartUrl(
    "artifacts",
    objectKey,
    uploadId,
    partNumber
  );
  const response = await fetch(url, {
    method: "PUT",
    body: body as Uint8Array<ArrayBuffer>,
    redirect: "error",
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
  });
  await response.body?.cancel().catch(() => undefined);
  const etag = response.headers.get("etag");
  if (!response.ok || !etag) throw new Error("Artifact multipart upload failed");
  return { partNumber, etag };
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
