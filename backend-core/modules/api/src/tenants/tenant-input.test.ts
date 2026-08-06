import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createProjectInput,
  createWorkspaceInput,
  updateWorkspaceAvatarInput,
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

test("accepts a bounded workspace avatar with a matching signature", () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(24)
  ]);
  const avatar = updateWorkspaceAvatarInput({
    contentType: "image/png",
    data: png.toString("base64")
  });
  assert.equal(avatar.contentType, "image/png");
  assert.deepEqual(avatar.data, png);
});

test("rejects mismatched or oversized workspace avatar payloads", () => {
  assert.throws(
    () => updateWorkspaceAvatarInput({
      contentType: "image/jpeg",
      data: Buffer.alloc(32).toString("base64")
    }),
    (error) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "INVALID_IMAGE"
  );
  const oversized = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(512 * 1_024)
  ]);
  assert.throws(
    () => updateWorkspaceAvatarInput({
      contentType: "image/png",
      data: oversized.toString("base64")
    }),
    (error) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "FILE_TOO_LARGE"
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
