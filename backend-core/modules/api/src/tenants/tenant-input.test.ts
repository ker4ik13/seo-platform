import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createProjectInput,
  createWorkspaceInput,
  updateWorkspaceInput
} from "./tenant-input.js";

test("parses workspace input and normalizes currency", () => {
  const input = createWorkspaceInput({
    name: "Agency",
    billingCurrency: "usd",
    country: "US"
  });
  assert.equal(input.billingCurrency, "USD");
  assert.equal(input.country, "US");
});

test("supports explicitly clearing workspace country", () => {
  assert.deepEqual(updateWorkspaceInput({ country: null }), {
    country: null
  });
});

test("rejects an empty workspace update", () => {
  assert.throws(
    () => updateWorkspaceInput({}),
    (error) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "EMPTY_UPDATE"
  );
});

test("preserves duplicate-domain confirmation", () => {
  const input = createProjectInput({
    name: "Site",
    domain: "example.com",
    confirmDuplicateDomain: true
  });
  assert.equal(input.confirmDuplicateDomain, true);
});
