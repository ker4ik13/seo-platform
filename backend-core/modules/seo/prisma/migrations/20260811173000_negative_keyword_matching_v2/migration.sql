ALTER TABLE "semantic_negative_keyword_presets"
  ADD COLUMN "ignore_word_order" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "ignore_punctuation" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "semantic_negative_keyword_presets"
  DROP CONSTRAINT "semantic_negative_keyword_presets_match_mode";

ALTER TABLE "semantic_negative_keyword_presets"
  ADD CONSTRAINT "semantic_negative_keyword_presets_match_mode"
  CHECK (
    "match_mode" IN (
      'CONTAINS',
      'WHOLE_WORD',
      'EXACT_PHRASE',
      'WORD_FORM_FAST',
      'WORD_FORM_PRECISE'
    )
  );
