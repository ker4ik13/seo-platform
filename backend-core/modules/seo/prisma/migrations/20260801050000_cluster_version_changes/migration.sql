ALTER TABLE "semantic_entity_changes"
  ADD CONSTRAINT "semantic_entity_changes_entity_type_v2_check"
    CHECK ("entity_type" IN ('KEYWORD', 'CLUSTER')) NOT VALID;

ALTER TABLE "semantic_entity_changes"
  VALIDATE CONSTRAINT "semantic_entity_changes_entity_type_v2_check";

ALTER TABLE "semantic_entity_changes"
  DROP CONSTRAINT "semantic_entity_changes_entity_type_check";

ALTER TABLE "semantic_entity_changes"
  RENAME CONSTRAINT "semantic_entity_changes_entity_type_v2_check"
  TO "semantic_entity_changes_entity_type_check";
