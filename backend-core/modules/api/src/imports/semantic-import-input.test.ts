import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  configureSemanticImportInput,
  createSemanticImportInput
} from "./semantic-import-input.js";

test("parses explicit or default semantic import options", () => {
  const uploadId = "01900000-0000-7000-8000-000000000005";
  assert.deepEqual(createSemanticImportInput({ uploadId }), {
    uploadId,
    parse: {
      encoding: "AUTO",
      delimiter: "AUTO",
      headerMode: "AUTO"
    }
  });
  assert.deepEqual(
    createSemanticImportInput({
      uploadId,
      parse: {
        encoding: "WINDOWS_1251",
        delimiter: "SEMICOLON",
        headerMode: "PRESENT"
      }
    }).parse,
    {
      encoding: "WINDOWS_1251",
      delimiter: "SEMICOLON",
      headerMode: "PRESENT"
    }
  );
});

test("requires one keyword column and preserves custom mappings", () => {
  assert.deepEqual(
    configureSemanticImportInput(
      {
        columns: [
          { sourceIndex: 0, target: "keyword.text" },
          {
            sourceIndex: 1,
            target: "custom",
            customName: "Мой показатель"
          }
        ],
        defaultLanguage: "ru",
        groupSeparator: ">",
        duplicatePolicy: "MERGE_NON_EMPTY",
        createMissingKeywords: true
      },
      3
    ),
    {
      version: 3,
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        {
          sourceIndex: 1,
          target: "custom",
          customName: "Мой показатель"
        }
      ],
      defaultLanguage: "ru",
      groupSeparator: ">",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: true
    }
  );
  assert.equal(
    configureSemanticImportInput(
      { columns: [{ sourceIndex: 0, target: "keyword.text" }] },
      4
    ).createMissingKeywords,
    false
  );
  assert.throws(
    () =>
      configureSemanticImportInput(
        {
          columns: [{ sourceIndex: 0, target: "keyword.text" }],
          createMissingKeywords: "true"
        },
        5
      ),
    DomainError
  );
  assert.throws(
    () =>
      configureSemanticImportInput(
        { columns: [{ sourceIndex: 0, target: "custom" }] },
        1
      ),
    DomainError
  );
});

test("rejects invalid semantic import identifiers and parse options", () => {
  assert.throws(
    () => createSemanticImportInput({ uploadId: "not-an-id" }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticImportInput({
        uploadId: "01900000-0000-7000-8000-000000000005",
        parse: { encoding: "KOI8_R" }
      }),
    DomainError
  );
});
