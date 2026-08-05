import assert from "node:assert/strict";
import test from "node:test";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { ImportWorkerModule } from "./import-worker.module.js";
import { KeywordResearchImportService } from "./keyword-research/keyword-research-import.service.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";

test("import worker wires the keyword research publisher dependency", () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    ImportWorkerModule
  ) as readonly unknown[] | undefined;
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    ImportWorkerModule
  ) as readonly unknown[] | undefined;

  assert.ok(imports?.includes(SeoDataModule));
  assert.ok(providers?.includes(KeywordResearchImportService));
});
