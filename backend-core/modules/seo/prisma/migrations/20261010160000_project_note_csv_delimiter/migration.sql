ALTER TABLE "project_notes" ADD COLUMN "delimiter" VARCHAR(4);

-- NULL сохраняет автоопределение старых CSV, содержимое файлов не меняется.
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_csv_delimiter_check"
  CHECK ("delimiter" IS NULL OR (
    "format" = 'CSV' AND char_length("delimiter") = 1
    AND "delimiter" <> '"' AND "delimiter" !~ '[[:cntrl:]]'
  ));
