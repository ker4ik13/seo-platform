ALTER TABLE "projects"
  ADD COLUMN "search_city_name" VARCHAR(160),
  ADD COLUMN "search_city_yandex_region_code" VARCHAR(16),
  ADD COLUMN "search_city_google_region_code" VARCHAR(16);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_search_city_complete_check"
  CHECK (
    (
      "search_city_name" IS NULL
      AND "search_city_yandex_region_code" IS NULL
      AND "search_city_google_region_code" IS NULL
    )
    OR
    (
      "search_city_name" IS NOT NULL
      AND "search_city_yandex_region_code" ~ '^[0-9]{1,10}$'
      AND "search_city_google_region_code" ~ '^[0-9]{1,10}$'
    )
  );
