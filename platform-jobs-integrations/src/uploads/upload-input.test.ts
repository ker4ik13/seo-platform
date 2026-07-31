import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  completeUploadInput,
  createUploadPartUrlsInput,
  internalCreateUploadInput
} from "./upload-input.js";

const validCreate = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  idempotencyKey: "upload-01900000-0000-7000-8000-000000000004",
  fileName: "keywords.csv",
  mediaType: "text/csv",
  sizeBytes: "1024",
  checksumSha256: "a".repeat(64),
  entitlement: {
    planCode: "TRIAL",
    planVersion: 1,
    storageBytes: 536_870_912
  }
};

test("parses an internal multipart upload command", () => {
  assert.deepEqual(
    internalCreateUploadInput(validCreate, 10_000),
    validCreate
  );
  const withoutChecksum = {
    workspaceId: validCreate.workspaceId,
    projectId: validCreate.projectId,
    actorId: validCreate.actorId,
    idempotencyKey: validCreate.idempotencyKey,
    fileName: validCreate.fileName,
    mediaType: validCreate.mediaType,
    sizeBytes: validCreate.sizeBytes,
    entitlement: validCreate.entitlement
  };
  assert.deepEqual(
    internalCreateUploadInput(withoutChecksum, 10_000),
    withoutChecksum
  );
});

test("rejects paths and oversized upload declarations", () => {
  assert.throws(
    () =>
      internalCreateUploadInput(
        { ...validCreate, fileName: "../keywords.csv" },
        10_000
      ),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateUploadInput(
        { ...validCreate, sizeBytes: "10001" },
        10_000
      ),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateUploadInput(
        {
          ...validCreate,
          entitlement: {
            ...validCreate.entitlement,
            storageBytes: 0
          }
        },
        10_000
      ),
    BadRequestException
  );
});

test("requires unique part numbers and valid S3 ETags", () => {
  assert.deepEqual(createUploadPartUrlsInput({ partNumbers: [1, 2] }), {
    partNumbers: [1, 2]
  });
  assert.throws(
    () => createUploadPartUrlsInput({ partNumbers: [1, 1] }),
    BadRequestException
  );
  assert.deepEqual(
    completeUploadInput({
      parts: [
        {
          partNumber: 1,
          etag: "\"d41d8cd98f00b204e9800998ecf8427e\""
        }
      ]
    }).parts[0]?.partNumber,
    1
  );
});
