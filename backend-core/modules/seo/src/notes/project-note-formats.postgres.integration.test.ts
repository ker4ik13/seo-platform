import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaService } from "../database/prisma.service.js";
import { ProjectNoteService } from "./project-note.service.js";

const databaseUrl = process.env.SEO_NOTE_FORMATS_TEST_DATABASE_URL;
test("file formats persist and public links remain tenant-safe", { skip: !databaseUrl }, async () => {
  const prisma = new PrismaService({ databaseUrl: databaseUrl!, databasePoolMax: 2 } as ConstructorParameters<typeof PrismaService>[0]);
  try {
    const service = new ProjectNoteService(prisma), workspaceId = randomUUID(), projectId = randomUUID(), actorId = randomUUID();
    for (const format of ["MARKDOWN", "TEXT", "CSV", "TSV", "JSON"] as const) {
      const markdown = format === "CSV" ? 'A,B\n"001","a,b"\n' : format === "TSV" ? "A\tB\n1\t2\n" : "  текст\n";
      const created = await service.create({ workspaceId, projectId, actorId, title: `Файл ${format}`, markdown, format, visibility: "PUBLIC" });
      const parsed = await service.get(workspaceId, projectId, created.id);
      assert.equal(parsed.format, format); assert.equal(parsed.markdown, markdown);
      const shared = await service.getPublic(created.publicToken!); assert.equal(shared.format, format);
      await assert.rejects(service.get(randomUUID(), projectId, created.id));
      await service.update(created.id, { workspaceId, projectId, actorId, version: created.version, visibility: "PROJECT_MEMBERS" });
      await assert.rejects(service.getPublic(created.publicToken!));
    }
    const legacy = await service.create({ workspaceId, projectId, actorId, title: "Старая заметка", markdown: "# Текст", visibility: "PROJECT_MEMBERS" });
    assert.equal(legacy.format, "MARKDOWN");
  } finally { await prisma.$disconnect(); }
});

test("CSV delimiter changes preserve cells, legacy files and public projections", { skip: !databaseUrl }, async () => {
  const prisma = new PrismaService({ databaseUrl: databaseUrl!, databasePoolMax: 2 } as ConstructorParameters<typeof PrismaService>[0]);
  try {
    const service = new ProjectNoteService(prisma), scope = { workspaceId: randomUUID(), projectId: randomUUID(), actorId: randomUUID() };
    let note = await service.create({ ...scope, title: "CSV", format: "CSV", markdown: 'A;B\n001;"two\nlines"', delimiter: ";", visibility: "PUBLIC" });
    assert.equal(note.delimiter, ";");
    for (const delimiter of ["|", "🧩", ","]) {
      note = await service.update(note.id, { ...scope, version: note.version, delimiter });
      assert.equal(note.delimiter, delimiter);
      assert.equal((await service.getPublic(note.publicToken!)).delimiter, delimiter);
      assert.equal((await prisma.projectNote.findUniqueOrThrow({ where: { id: note.id } })).delimiter, delimiter);
    }
    assert.equal(note.markdown, 'A,B\n001,"two\nlines"');
    note = await service.update(note.id, { ...scope, version: note.version, format: "TEXT" });
    assert.equal(note.delimiter, undefined);
    await assert.rejects(service.update(note.id, { ...scope, version: note.version, delimiter: ";" }));
    const legacy = await prisma.projectNote.create({ data: { workspaceId: scope.workspaceId, projectId: scope.projectId, title: "Legacy CSV", format: "CSV", markdown: "A;B\n1;2", createdBy: scope.actorId, updatedBy: scope.actorId } });
    const changed = await service.update(legacy.id, { ...scope, version: legacy.version, delimiter: "|" });
    assert.equal(changed.markdown, "A|B\n1|2");
  } finally { await prisma.$disconnect(); }
});
