-- Project workspace re-keying is the only flow that changes tenant keys.
-- Make tenant foreign keys transaction-deferred and replace immediate
-- ON UPDATE RESTRICT with equivalent deferred NO ACTION checks.
DO $migration$
DECLARE
  constraint_record RECORD;
  definition TEXT;
BEGIN
  FOR constraint_record IN
    SELECT
      constraint_row.conrelid::regclass AS relation_name,
      constraint_row.conname AS constraint_name,
      pg_get_constraintdef(constraint_row.oid) AS constraint_definition
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.contype = 'f'
      AND constraint_row.connamespace = 'public'::regnamespace
      AND EXISTS (
        SELECT 1
        FROM unnest(constraint_row.conkey) AS key_column(attnum)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        WHERE attribute.attname = 'workspace_id'
      )
    ORDER BY constraint_row.conrelid, constraint_row.conname
  LOOP
    definition := replace(
      constraint_record.constraint_definition,
      'ON UPDATE RESTRICT',
      'ON UPDATE NO ACTION'
    );
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      constraint_record.relation_name,
      constraint_record.constraint_name
    );
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I %s DEFERRABLE INITIALLY IMMEDIATE',
      constraint_record.relation_name,
      constraint_record.constraint_name,
      definition
    );
  END LOOP;
END
$migration$;

CREATE FUNCTION transfer_seo_project_workspace(
  source_workspace_id UUID,
  destination_workspace_id UUID,
  transferred_project_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  relation_record RECORD;
  has_foreign_tenant BOOLEAN;
  changed_rows BIGINT;
  affected_rows BIGINT := 0;
BEGIN
  IF source_workspace_id = destination_workspace_id THEN
    RAISE EXCEPTION 'source and destination workspace must differ';
  END IF;

  FOR relation_record IN
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname <> 'outbox_events'
      AND EXISTS (
        SELECT 1 FROM pg_attribute AS attribute
        WHERE attribute.attrelid = relation.oid
          AND attribute.attname = 'workspace_id'
          AND NOT attribute.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute AS attribute
        WHERE attribute.attrelid = relation.oid
          AND attribute.attname = 'project_id'
          AND NOT attribute.attisdropped
      )
    ORDER BY relation.oid
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM public.%I
         WHERE project_id = $1
           AND workspace_id <> ALL ($2)
       )',
      relation_record.relname
    )
    INTO has_foreign_tenant
    USING transferred_project_id,
      ARRAY[source_workspace_id, destination_workspace_id]::UUID[];

    IF has_foreign_tenant THEN
      RAISE EXCEPTION 'project data belongs to an unexpected workspace';
    END IF;
  END LOOP;

  SET CONSTRAINTS ALL DEFERRED;

  FOR relation_record IN
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname <> 'outbox_events'
      AND EXISTS (
        SELECT 1 FROM pg_attribute AS attribute
        WHERE attribute.attrelid = relation.oid
          AND attribute.attname = 'workspace_id'
          AND NOT attribute.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute AS attribute
        WHERE attribute.attrelid = relation.oid
          AND attribute.attname = 'project_id'
          AND NOT attribute.attisdropped
      )
    ORDER BY relation.oid
  LOOP
    EXECUTE format(
      'UPDATE public.%I
       SET workspace_id = $1
       WHERE workspace_id = $2
         AND project_id = $3',
      relation_record.relname
    )
    USING destination_workspace_id, source_workspace_id, transferred_project_id;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    affected_rows := affected_rows + changed_rows;
  END LOOP;

  RETURN affected_rows;
END
$function$;

REVOKE ALL ON FUNCTION transfer_seo_project_workspace(UUID, UUID, UUID)
  FROM PUBLIC;
