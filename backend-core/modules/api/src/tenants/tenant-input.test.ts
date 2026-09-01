import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createProjectInput,
  createWorkspaceInput,
  deleteProjectInput,
  reorderProjectsInput,
  updateProjectInput,
  updateProjectLogoInput,
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

test("accepts safe SVG project logos and rejects executable SVG", () => {
  const safe = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>'
  );
  assert.deepEqual(
    updateProjectLogoInput({
      contentType: "image/svg+xml",
      data: safe.toString("base64")
    }),
    { contentType: "image/svg+xml", data: safe }
  );
  const unsafe = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
  );
  assert.throws(
    () =>
      updateProjectLogoInput({
        contentType: "image/svg+xml",
        data: unsafe.toString("base64")
      }),
    (error) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "INVALID_IMAGE"
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

test("accepts and explicitly clears a paired project search city", () => {
  const searchCity = {
    name: "Санкт-Петербург",
    yandexRegionCode: "2",
    googleRegionCode: "1012040"
  };
  assert.deepEqual(updateProjectInput({ searchCity }), { searchCity });
  assert.deepEqual(updateProjectInput({ searchCity: null }), {
    searchCity: null
  });
  assert.throws(() =>
    updateProjectInput({
      searchCity: { ...searchCity, yandexRegionCode: "not-a-region" }
    })
  );
});

test("requires an exact non-empty project deletion confirmation", () => {
  assert.deepEqual(deleteProjectInput({ confirmation: "Нейролюб" }), {
    confirmation: "Нейролюб"
  });
  assert.throws(() => deleteProjectInput({ confirmation: "" }), DomainError);
});

test("accepts only exact unique project-order arrays", () => {
  const first = "01900000-0000-7000-8000-000000000061";
  const second = "01900000-0000-7000-8000-000000000062";
  assert.deepEqual(
    reorderProjectsInput({
      expectedProjectIds: [first, second],
      projectIds: [second, first]
    }),
    {
      expectedProjectIds: [first, second],
      projectIds: [second, first]
    }
  );
  assert.throws(
    () =>
      reorderProjectsInput({
        expectedProjectIds: [first, first],
        projectIds: [first]
      }),
    DomainError
  );
  assert.throws(
    () =>
      reorderProjectsInput({
        expectedProjectIds: [first],
        projectIds: [first],
        workspaceId: first
      }),
    DomainError
  );
});
