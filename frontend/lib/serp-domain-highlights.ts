interface SerpDomainResultLike {
  readonly url: string;
}

interface SerpDomainSnapshotLike {
  readonly results: readonly SerpDomainResultLike[];
}

interface SerpDomainRowLike {
  readonly snapshots: readonly SerpDomainSnapshotLike[];
  readonly aiSnapshots: readonly SerpDomainSnapshotLike[];
}

// Green remains reserved for the project domain. The remaining hue families
// deliberately jump around the wheel so neighbouring slots remain easy to
// distinguish in a dense SERP matrix.
const DOMAIN_HUES = [
  258, 8, 205, 35, 302, 184, 340, 226,
  20, 280, 194, 324, 244, 48, 312, 174,
  354, 216, 66, 270, 190, 334, 234, 14,
  294, 200, 42, 318, 250, 2, 180, 346
] as const;

const DOMAIN_COLOR_PALETTE = DOMAIN_HUES.flatMap((hue, index) => [
  `hsl(${hue} ${index % 2 === 0 ? 72 : 78}% ${index % 3 === 0 ? 34 : 39}%)`,
  `hsl(${hue} ${index % 2 === 0 ? 64 : 70}% ${index % 3 === 0 ? 45 : 48}%)`
]);

export function normalizedSerpDomain(value: string): string | undefined {
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return undefined;
  }
}

export function repeatedSerpDomains(
  rows: readonly SerpDomainRowLike[],
  mode: "organic" | "ai"
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const snapshots = mode === "ai" ? row.aiSnapshots : row.snapshots;
    for (const snapshot of snapshots) {
      for (const result of snapshot.results) {
        const domain = normalizedSerpDomain(result.url);
        if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
      }
    }
  }
  return new Set(
    [...counts]
      .filter(([, count]) => count > 1)
      .map(([domain]) => domain)
  );
}

export function assignSerpDomainColors(
  domains: Iterable<string>
): ReadonlyMap<string, string> {
  const normalized = [...new Set(
    [...domains].flatMap((domain) => {
      const value = normalizedSerpDomain(domain);
      return value ? [value] : [];
    })
  )].sort();
  const assigned = new Map<string, string>();
  const used = new Set<number>();

  for (const domain of normalized) {
    const hash = stableDomainHash(domain);
    let index = hash % DOMAIN_COLOR_PALETTE.length;
    // Palette length is a power of two, so every odd step visits all slots.
    const step = (((hash >>> 16) % (DOMAIN_COLOR_PALETTE.length / 2)) * 2) + 1;
    let attempts = 0;
    while (used.has(index) && attempts < DOMAIN_COLOR_PALETTE.length) {
      index = (index + step) % DOMAIN_COLOR_PALETTE.length;
      attempts += 1;
    }
    if (attempts < DOMAIN_COLOR_PALETTE.length) used.add(index);
    assigned.set(
      domain,
      attempts < DOMAIN_COLOR_PALETTE.length
        ? DOMAIN_COLOR_PALETTE[index]!
        : overflowDomainColor(hash, attempts)
    );
  }
  return assigned;
}

function stableDomainHash(domain: string): number {
  let hash = 0x811c9dc5;
  for (const character of domain) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 0x01000193) >>> 0;
  }
  return hash;
}

function overflowDomainColor(hash: number, offset: number): string {
  const hue = (hash + Math.imul(offset + 1, 137)) % 360;
  const saturation = 62 + ((hash >>> 8) % 19);
  const lightness = 32 + ((hash >>> 24) % 15);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
