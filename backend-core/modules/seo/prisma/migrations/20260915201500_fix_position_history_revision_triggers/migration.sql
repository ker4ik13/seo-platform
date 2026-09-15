BEGIN;

-- Statement transition tables can contain thousands of rows for one project.
-- Keep volatile clock_timestamp() outside DISTINCT, otherwise every source row
-- remains distinct and one INSERT attempts to update the same revision twice.
CREATE OR REPLACE FUNCTION bump_project_position_history_revision_from_new_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT scope.workspace_id, scope.project_id, 1, clock_timestamp()
  FROM (
    SELECT DISTINCT workspace_id, project_id
    FROM new_rows
  ) scope
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION bump_project_position_history_revision_from_old_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT scope.workspace_id, scope.project_id, 1, clock_timestamp()
  FROM (
    SELECT DISTINCT workspace_id, project_id
    FROM old_rows
  ) scope
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION bump_project_position_history_revision_from_keyword_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT scope.workspace_id, scope.project_id, 1, clock_timestamp()
  FROM (
    SELECT DISTINCT next_row.workspace_id, next_row.project_id
    FROM new_rows next_row
    INNER JOIN old_rows previous_row ON previous_row.id = next_row.id
    WHERE next_row.status IS DISTINCT FROM previous_row.status
       OR next_row.is_tracked IS DISTINCT FROM previous_row.is_tracked
  ) scope
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION bump_project_position_history_revision_from_context_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT scope.workspace_id, scope.project_id, 1, clock_timestamp()
  FROM (
    SELECT DISTINCT next_row.workspace_id, next_row.project_id
    FROM new_rows next_row
    INNER JOIN old_rows previous_row ON previous_row.id = next_row.id
    WHERE next_row.status IS DISTINCT FROM previous_row.status
  ) scope
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION bump_project_position_history_revision_from_merge_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT scope.workspace_id, scope.project_id, 1, clock_timestamp()
  FROM (
    SELECT DISTINCT next_row.workspace_id, next_row.project_id
    FROM new_rows next_row
    INNER JOIN old_rows previous_row ON previous_row.id = next_row.id
    WHERE next_row.source_keyword_id IS DISTINCT FROM previous_row.source_keyword_id
       OR next_row.target_keyword_id IS DISTINCT FROM previous_row.target_keyword_id
  ) scope
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_new_rows()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_old_rows()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_keyword_updates()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_context_updates()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_merge_updates()
  FROM PUBLIC;

COMMIT;
