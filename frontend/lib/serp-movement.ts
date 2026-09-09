export type SerpMovement = Readonly<{
  previousPosition?: number;
  urlChanged?: boolean;
}>;

export interface SerpMovementSnapshot {
  readonly snapshotId: string;
  readonly results: readonly Readonly<{
    position: number;
    url: string;
  }>[];
}

export function serpMovements(
  snapshots: readonly SerpMovementSnapshot[]
): ReadonlyMap<string, SerpMovement> {
  const result = new Map<string, SerpMovement>();
  for (let index = 0; index < snapshots.length - 1; index += 1) {
    const current = snapshots[index]!;
    const previous = snapshots[index + 1]!;
    const previousPositions = new Map<string, Readonly<{
      position: number;
      url: string;
    }>>();
    for (const row of previous.results) {
      const key = resultSiteKey(row.url);
      const saved = previousPositions.get(key);
      if (!saved || row.position < saved.position) {
        previousPositions.set(key, {
          position: row.position,
          url: resultPageKey(row.url)
        });
      }
    }
    for (const row of current.results) {
      const previous = previousPositions.get(resultSiteKey(row.url));
      result.set(
        serpMovementKey(current.snapshotId, row.url),
        previous === undefined
          ? {}
          : {
              previousPosition: previous.position,
              ...(previous.url === resultPageKey(row.url)
                ? {}
                : { urlChanged: true })
            }
      );
    }
  }
  return result;
}

export function serpMovementKey(snapshotId: string, url: string): string {
  return `${snapshotId}\u0000${resultPageKey(url)}`;
}

function resultSiteKey(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return value.trim().toLowerCase();
  }
}

function resultPageKey(value: string): string {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}
