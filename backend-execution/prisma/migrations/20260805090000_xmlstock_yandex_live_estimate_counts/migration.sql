BEGIN;

-- XMLStock Yandex supports two different products. Search API is asynchronous
-- (submit + check), while Yandex Live is paginated and uses only GET requests.
-- The previous constraint selected the request shape by search engine alone,
-- which rejected every valid Yandex Live estimate before a Job was created.
ALTER TABLE public.rank_estimates
  DROP CONSTRAINT rank_estimates_counts_bounded,
  ADD CONSTRAINT rank_estimates_counts_bounded
  CHECK (
    keyword_count >= 0
    AND provider_task_count >= 0
    AND minimum_submit_request_count >= 0
    AND minimum_check_request_count >= 0
    AND minimum_get_request_count >= 0
    AND (
      (
        provider = 'ARSENKIN'
        AND provider_policy_version = 'manual-arsenkin-positions@1.0.0'
        AND keyword_count <= 1001
        AND provider_task_count <= 4
        AND minimum_submit_request_count = provider_task_count
        AND minimum_check_request_count = provider_task_count
        AND minimum_get_request_count = provider_task_count
        AND (
          (keyword_count <= 1000 AND provider_task_count = ((keyword_count + 249) / 250))
          OR (keyword_count = 1001 AND provider_task_count = 0)
        )
      )
      OR (
        provider = 'ARSENKIN'
        AND provider_policy_version = 'manual-arsenkin-positions@2.0.0'
        AND keyword_count <= 15001
        AND provider_task_count <= 1
        AND minimum_submit_request_count = provider_task_count
        AND minimum_check_request_count = provider_task_count
        AND minimum_get_request_count = provider_task_count
        AND (
          (keyword_count BETWEEN 1 AND 15000 AND provider_task_count = 1)
          OR (keyword_count IN (0, 15001) AND provider_task_count = 0)
        )
      )
      OR (
        provider = 'XMLSTOCK'
        AND provider_policy_version = 'manual-xmlstock-serp@1.0.0'
        AND keyword_count <= 15001
        AND provider_task_count <= 15000
        AND (
          (keyword_count BETWEEN 1 AND 15000 AND provider_task_count = keyword_count)
          OR (keyword_count IN (0, 15001) AND provider_task_count = 0)
        )
        AND execution_snapshot IS NOT NULL
        AND (
          (
            execution_snapshot ->> 'searchEngine' = 'YANDEX'
            AND execution_snapshot ->> 'providerMappingVersion' IN (
              'xmlstock-serp@1',
              'xmlstock-yandex-search-api@2'
            )
            AND minimum_submit_request_count = provider_task_count
            AND minimum_check_request_count = provider_task_count
            AND minimum_get_request_count = 0
          )
          OR (
            execution_snapshot ->> 'searchEngine' = 'YANDEX'
            AND execution_snapshot ->> 'providerMappingVersion' =
              'xmlstock-yandex-live@2'
            AND minimum_submit_request_count = 0
            AND minimum_check_request_count = 0
            AND minimum_get_request_count = provider_task_count *
              (((execution_snapshot ->> 'depth')::integer + 9) / 10)
          )
          OR (
            execution_snapshot ->> 'searchEngine' = 'GOOGLE'
            AND execution_snapshot ->> 'providerMappingVersion' IN (
              'xmlstock-serp@1',
              'xmlstock-google-live@2'
            )
            AND minimum_submit_request_count = 0
            AND minimum_check_request_count = 0
            AND minimum_get_request_count = provider_task_count *
              (((execution_snapshot ->> 'depth')::integer + 9) / 10)
          )
        )
      )
    )
  ) NOT VALID;

ALTER TABLE public.rank_estimates
  VALIDATE CONSTRAINT rank_estimates_counts_bounded;

COMMIT;
