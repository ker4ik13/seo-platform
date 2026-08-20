ALTER TABLE "semantic_negative_keyword_presets"
  DROP CONSTRAINT "semantic_negative_keyword_presets_words_count";

ALTER TABLE "semantic_negative_keyword_presets"
  ADD CONSTRAINT "semantic_negative_keyword_presets_words_count"
  CHECK (cardinality("words") BETWEEN 1 AND 1200)
  NOT VALID;

ALTER TABLE "semantic_negative_keyword_presets"
  VALIDATE CONSTRAINT "semantic_negative_keyword_presets_words_count";
