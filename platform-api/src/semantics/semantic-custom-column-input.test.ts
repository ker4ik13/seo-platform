import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticCustomColumnInput,
  setSemanticKeywordCustomValueInput,
  updateSemanticCustomColumnInput
} from "./semantic-custom-column-input.js";

test("normalizes a typed option column and value CAS input", () => {
  assert.deepEqual(
    createSemanticCustomColumnInput({
      name: "  Этап работ ",
      type: "STATUS",
      config: {
        required: true,
        options: [
          { id: "new", label: " Новое ", color: "#AABBCC" },
          { id: "done", label: "Готово" }
        ]
      }
    }),
    {
      name: "Этап работ",
      type: "STATUS",
      config: {
        required: true,
        options: [
          { id: "new", label: "Новое", color: "#aabbcc" },
          { id: "done", label: "Готово" }
        ]
      }
    }
  );
  assert.deepEqual(
    setSemanticKeywordCustomValueInput({
      expectedVersion: null,
      value: ["new", "done"]
    }),
    { expectedVersion: null, value: ["new", "done"] }
  );
  assert.deepEqual(updateSemanticCustomColumnInput({ description: null }), {
    description: null
  });
});

test("rejects incompatible config, duplicate options and blind values", () => {
  assert.throws(
    () =>
      createSemanticCustomColumnInput({
        name: "Text",
        type: "TEXT",
        config: {
          required: false,
          options: [{ id: "bad", label: "Bad" }]
        }
      }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticCustomColumnInput({
        name: "Status",
        type: "STATUS",
        config: {
          required: false,
          options: [
            { id: "same", label: "One" },
            { id: "same", label: "Two" }
          ]
        }
      }),
    DomainError
  );
  assert.throws(
    () => setSemanticKeywordCustomValueInput({ value: "missing CAS" }),
    DomainError
  );
  assert.throws(() => updateSemanticCustomColumnInput({}), DomainError);
});
