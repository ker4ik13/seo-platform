import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Stable fingerprint of the executable worker code, without Git or Docker access. */
export async function workerBuildHash(
  root = resolve(fileURLToPath(new URL("..", import.meta.url)))
): Promise<string> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  // Runtime images contain compiled JS. The TS fallback is for source-level
  // tests and local development before the first build.
  const javascript = files.filter((file) => file.endsWith(".js"));
  const sources = files.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  const selected = javascript.length > 0 ? javascript : sources;
  if (selected.length === 0) throw new Error("Worker build has no executable source");
  const digest = createHash("sha256");
  for (const file of selected.sort()) {
    digest.update(relative(root, file).split(sep).join("/"));
    digest.update("\0");
    // Git for Windows may check out source files with CRLF. TypeScript can
    // preserve those endings in emitted JS even inside the same Docker image.
    digest.update((await readFile(file, "utf8")).replaceAll("\r\n", "\n"));
    digest.update("\0");
  }
  return digest.digest("hex");
}
