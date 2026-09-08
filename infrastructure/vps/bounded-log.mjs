import { chmod, open, rename, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_LOG_BYTES = 10 * 1024 * 1024;

// Backpressure bounds memory even when a child writes faster than the disk.
// Only the current file and one previous segment are retained.
export async function writeBoundedLog(input, logPath, maxBytes = MAX_LOG_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("Invalid log size limit");
  }
  let file = await open(logPath, "a+", 0o600);
  await chmod(logPath, 0o600);
  let size = (await file.stat()).size;
  try {
    // An older supervisor may have left an unbounded file. Preserve only its
    // tail before opening a fresh segment; never retain a multi-GB archive.
    if (size > maxBytes) {
      const tail = Buffer.alloc(maxBytes);
      const { bytesRead } = await file.read(tail, 0, maxBytes, size - maxBytes);
      const previous = await open(`${logPath}.1`, "w", 0o600);
      try {
        await previous.chmod(0o600);
        await previous.writeFile(tail.subarray(0, bytesRead));
      } finally {
        await previous.close();
      }
      await file.truncate(0);
      size = 0;
    }
    const previousSize = await stat(`${logPath}.1`).then(s => s.size).catch(() => 0);
    if (previousSize > maxBytes) {
      const previous = await open(`${logPath}.1`, "r+");
      try {
        const tail = Buffer.alloc(maxBytes);
        const { bytesRead } = await previous.read(tail, 0, maxBytes, previousSize - maxBytes);
        await previous.write(tail.subarray(0, bytesRead), 0, bytesRead, 0);
        await previous.truncate(bytesRead);
        await previous.chmod(0o600);
      } finally {
        await previous.close();
      }
    }
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < bytes.length) {
        if (size >= maxBytes) {
          await file.close();
          await rename(logPath, `${logPath}.1`);
          file = await open(logPath, "a+", 0o600);
          size = 0;
        }
        const length = Math.min(bytes.length - offset, maxBytes - size);
        await file.writeFile(bytes.subarray(offset, offset + length));
        offset += length;
        size += length;
      }
    }
  } finally {
    await file.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logPath = process.argv[2];
  if (!logPath) throw new TypeError("Log path is required");
  await writeBoundedLog(process.stdin, logPath);
}
