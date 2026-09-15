ALTER TABLE "semantic_imports"
ADD COLUMN "project_domain" VARCHAR(253);

COMMENT ON COLUMN "semantic_imports"."project_domain" IS
  'Trusted normalized project host captured when the import is created; null only for pre-deployment imports.';
