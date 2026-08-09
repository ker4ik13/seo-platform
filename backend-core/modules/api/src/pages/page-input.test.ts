import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createProjectPageInput,
  projectPageQuery
} from "./page-input.js";

test("accepts a strict public page input without tenant context", () => {
  assert.deepEqual(
    createProjectPageInput({
      url: "HTTPS://EXAMPLE.COM:443/catalog#top",
      aliases: [],
      pageType: "EXISTING",
      indexability: "INDEXABLE",
      httpStatus: 200,
      language: "en-us",
      priority: 10
    }),
    {
      url: "https://example.com/catalog",
      aliases: [],
      pageType: "EXISTING",
      indexability: "INDEXABLE",
      httpStatus: 200,
      language: "en-US",
      priority: 10
    }
  );
});

test("rejects tenant injection and invalid page filters", () => {
  const base = {
    url: "https://example.com/",
    aliases: [],
    pageType: "PLANNED",
    indexability: "UNKNOWN",
    priority: 0
  };
  assert.throws(
    () => createProjectPageInput({ ...base, workspaceId: "attacker" }),
    DomainError
  );
  assert.throws(
    () => projectPageQuery({ lifecycleStatus: "DELETED" }),
    DomainError
  );
  assert.throws(() => projectPageQuery({ pathPrefix: "catalog/" }), DomainError);
  assert.throws(
    () => projectPageQuery({ pathPrefix: "/catalog/?page=2" }),
    DomainError
  );
});

test("accepts a site-structure path independently from text search", () => {
  assert.deepEqual(
    projectPageQuery({
      limit: "50",
      search: "товар",
      pathPrefix: "/catalog/",
      lifecycleStatus: "ACTIVE"
    }),
    {
      limit: 50,
      search: "товар",
      pathPrefix: "/catalog/",
      lifecycleStatus: "ACTIVE"
    }
  );
});
