import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const backendSources = [
  "backend-core/modules/api/src",
  "backend-core/modules/seo/src",
  "backend-execution/src",
  "backend-core/modules/realtime/src"
];

test("production database access never uses unsafe Prisma SQL APIs", async () => {
  const files = (
    await Promise.all(
      backendSources.map((directory) =>
        typescriptFiles(path.join(workspaceRoot, directory))
      )
    )
  ).flat();
  const violations = [];

  for (const file of files) {
    if (file.endsWith(".test.ts") || file.includes(`${path.sep}generated${path.sep}`)) {
      continue;
    }
    const source = await readFile(file, "utf8");
    if (/\$(?:queryRaw|executeRaw)Unsafe\b|Prisma\.raw\s*\(/u.test(source)) {
      violations.push(path.relative(workspaceRoot, file));
    }
  }

  assert.deepEqual(
    violations,
    [],
    "raw SQL must stay parameterized; unsafe interpolation requires an ADR and a dedicated security review"
  );
});

async function typescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    })
  );
  return nested.flat();
}
