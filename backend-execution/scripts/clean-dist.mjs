import { rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TypeScript does not remove JavaScript emitted for source files that were
// deleted later. Such leftovers must not change the worker build fingerprint.
const output = fileURLToPath(new URL("../dist/", import.meta.url));
if (basename(output) !== "dist" || basename(dirname(output)) !== "backend-execution") {
  throw new Error("Unexpected backend-execution build output path");
}
await rm(output, { recursive: true, force: true });
