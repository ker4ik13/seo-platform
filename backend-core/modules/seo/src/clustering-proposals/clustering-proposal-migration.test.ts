import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260820120000_clustering_proposals/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("stores a durable proposal separately from applied semantic entities", () => {
  assert.match(migration, /CREATE TABLE "clustering_proposals"/u);
  assert.match(migration, /CREATE TABLE "clustering_proposal_clusters"/u);
  assert.match(migration, /CREATE TABLE "clustering_proposal_items"/u);
  assert.match(migration, /"status" "ClusteringProposalStatus" NOT NULL DEFAULT 'READY'/u);
  assert.match(migration, /"semantic_version_ids" JSONB NOT NULL DEFAULT '\[\]'::jsonb/u);
  assert.match(migration, /CREATE UNIQUE INDEX "clustering_proposals_job_id_key"/u);
});

test("prevents proposal items from referencing a cluster from another proposal", () => {
  assert.match(
    migration,
    /FOREIGN KEY \("proposal_id", "proposal_cluster_id"\)[\s\S]*REFERENCES "clustering_proposal_clusters"\("proposal_id", "id"\)/u
  );
  assert.match(migration, /CREATE UNIQUE INDEX "clustering_proposal_clusters_proposal_id_id_key"/u);
});

test("keeps proposal receipts in the allowlisted project transfer", () => {
  assert.match(
    migration,
    /transferable_relations CONSTANT TEXT\[\] := ARRAY\[[\s\S]*'clustering_proposals'/u
  );
  assert.match(migration, /SET CONSTRAINTS ALL DEFERRED/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION transfer_seo_project_workspace/u);
});
