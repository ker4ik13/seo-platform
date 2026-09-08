import { lstat, mkdir, readdir, readFile, rm, statfs } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { writeBoundedLog } from "./bounded-log.mjs";

const DAY_MS = 86_400_000;
const LOG_LIMIT = 10 * 1024 * 1024;
const ARCHIVE_NAME = /(?:\.log\.\d+(?:\.gz)?|\.[a-z][a-z0-9-]*-\d{8}\.log(?:\.gz)?)$/u;
const PRIMARY_LOG_NAME = /^[a-z][a-z0-9-]*\.log$/u;
const TEMP_NAME = /^(?:smoke-runtime|smoke-public-api|e2e)\.[a-zA-Z0-9_-]+$/u;

export async function maintainRuntime(root, { now = Date.now(), dryRun = false } = {}) {
  const summary = { dryRun, compactedLogs: 0, removedArchives: 0, removedTemporaryDirectories: 0 };
  for (const directory of ["logs", "tmp"]) {
    const path = join(root, directory);
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isDirectory() || info.isSymbolicLink()) continue;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const itemPath = join(path, entry.name);
      const item = await lstat(itemPath);
      if (directory === "logs" && entry.isFile()) {
        if (ARCHIVE_NAME.test(entry.name) && now - item.mtimeMs > 14 * DAY_MS) {
          if (!dryRun) await rm(itemPath);
          summary.removedArchives++;
        } else if (PRIMARY_LOG_NAME.test(entry.name) && item.size > LOG_LIMIT) {
          if (!dryRun) await writeBoundedLog(Readable.from([]), itemPath, LOG_LIMIT);
          summary.compactedLogs++;
        }
      }
      if (directory === "tmp" && entry.isDirectory() && TEMP_NAME.test(entry.name) && now - item.mtimeMs > 7 * DAY_MS) {
        const pid = Number(await readFile(join(itemPath, "owner.pid"), "utf8").catch(() => "0"));
        if (Number.isSafeInteger(pid) && pid > 0 && processExists(pid)) continue;
        if (!dryRun) await rm(itemPath, { recursive: true, force: true });
        summary.removedTemporaryDirectories++;
      }
    }
  }
  const disk = await statfs(root);
  return { ...summary, freeBytes: disk.bavail * disk.bsize, diskHealthy: disk.bavail / disk.blocks >= 0.1 && disk.bavail * disk.bsize >= 1024 ** 3 };
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.argv[2] ?? "");
  const allowed = "/home/dev/.local/share/seo-platform-runtime";
  if (root !== allowed && !root.startsWith(`${allowed}/`)) throw new Error("Invalid runtime directory");
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Runtime directory must not be a symlink");
  await mkdir(join(root, "tmp"), { recursive: true, mode: 0o700 });
  const summary = await maintainRuntime(root, { dryRun: process.argv.includes("--dry-run") });
  console.log(JSON.stringify({ event: "runtime-maintenance", ...summary }));
  if (!summary.diskHealthy) process.exitCode = 1;
}
