BEGIN;

-- A project deletion is a retained tombstone, but live authorization edges
-- must disappear with it. Otherwise team and API-token editors expose an
-- override that can no longer pass project validation.
DELETE FROM public.project_member_access access
USING public.projects project
WHERE access.project_id = project.id
  AND (
    project.status = 'DELETED'
    OR project.deleted_at IS NOT NULL
  );

DELETE FROM public.api_token_project_accesses access
USING public.projects project
WHERE access.project_id = project.id
  AND access.workspace_id = project.workspace_id
  AND (
    project.status = 'DELETED'
    OR project.deleted_at IS NOT NULL
  );

UPDATE public.workspace_invites AS invite
SET project_accesses = (
      SELECT COALESCE(
        jsonb_agg(entry.item ORDER BY entry.ordinality),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(invite.project_accesses)
        WITH ORDINALITY AS entry(item, ordinality)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.projects project
        WHERE project.workspace_id = invite.workspace_id
          AND project.id::text = entry.item ->> 'projectId'
          AND (
            project.status = 'DELETED'
            OR project.deleted_at IS NOT NULL
          )
      )
    ),
    updated_at = clock_timestamp()
WHERE invite.status IN ('SENT', 'DELIVERED')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(invite.project_accesses) AS entry(item)
    JOIN public.projects project
      ON project.workspace_id = invite.workspace_id
     AND project.id::text = entry.item ->> 'projectId'
    WHERE project.status = 'DELETED'
       OR project.deleted_at IS NOT NULL
  );

COMMIT;
