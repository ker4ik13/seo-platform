export const semanticOperationScopePageSize = 1_000;
export const semanticOperationScopeCountPageSize = 1;

/**
 * Builds one union query for a folder scope. Using `groupIds` avoids the old
 * N-folders × N-pages request pattern while the API still performs an exact
 * distinct keyword count for the first page. The initial one-row probe keeps
 * the exact count response light; subsequent cursor pages materialize the
 * accepted scope in larger batches.
 */
export function semanticOperationScopeQuery(
  groupIds: readonly string[] | undefined,
  cursor?: string
): URLSearchParams {
  const query = new URLSearchParams({
    includeUntracked: "true",
    limit: String(
      cursor
        ? semanticOperationScopePageSize
        : semanticOperationScopeCountPageSize
    ),
    sort: "CREATED_ASC"
  });
  if (groupIds?.length === 1) query.set("groupId", groupIds[0]!);
  else if (groupIds && groupIds.length > 1) {
    query.set("groupIds", groupIds.join(","));
  }
  if (cursor) query.set("cursor", cursor);
  return query;
}
