-- Existing notes remain Markdown and retain their content, versions and public links.
CREATE TYPE "ProjectNoteFormat" AS ENUM ('MARKDOWN', 'TEXT', 'CSV', 'TSV', 'JSON');
ALTER TABLE "project_notes" ADD COLUMN "format" "ProjectNoteFormat" NOT NULL DEFAULT 'MARKDOWN';
