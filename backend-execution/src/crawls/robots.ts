export function robotsAllows(
  source: string,
  url: URL,
  crawlerToken = "seoplatformcrawler"
): boolean {
  return robotsAccess(source, url, crawlerToken).allowed;
}

export function robotsAccess(source: string, url: URL, crawlerToken = "seoplatformcrawler") {
  return createRobotsPolicy(source).access(url, crawlerToken);
}

function specificity(pattern: string): number { return Buffer.byteLength(pattern.replace(/[*$]/gu, ""), "utf8"); }

/** Compile once per crawl. Wildcards use linear string matching, never backtracking regex. */
export function createRobotsPolicy(source: string) {
  const groups = parseGroups(source);
  const compiled = new Map<string, { group: string; rules: readonly Rule[] }>();
  return { access(url: URL, token = "seoplatformcrawler") {
    const agent = token.toLowerCase();
    let policy = compiled.get(agent);
    if (!policy) {
      const candidates = groups.flatMap((group) => group.agents.filter((value) => value !== "*" && agent.startsWith(value)).map((value) => ({ value, rules: group.rules })));
      const length = candidates.reduce((max, value) => Math.max(max, value.value.length), 0);
      const selected = candidates.filter((value) => value.value.length === length);
      policy = { group: selected[0]?.value ?? "*", rules: (selected.length ? selected.flatMap((value) => value.rules) : groups.filter((group) => group.agents.includes("*")).flatMap((group) => group.rules)).map((rule) => ({ ...rule, normalized: normalizePath(rule.pattern) })).sort((a, b) => specificity(b.normalized!) - specificity(a.normalized!) || Number(b.allow) - Number(a.allow)) };
      compiled.set(agent, policy);
    }
    const path = normalizePath(`${url.pathname}${url.search}`);
    const rule = policy.rules.find((rule) => matches(path, rule.normalized ?? rule.pattern));
    return { allowed: rule?.allow ?? true, group: policy.group, ...(rule ? { rule: `${rule.allow ? "Allow" : "Disallow"}: ${rule.pattern}`.slice(0, 4_096) } : {}) };
  } };
}

interface Group {
  readonly agents: readonly string[];
  readonly rules: readonly Rule[];
}

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
  readonly normalized?: string;
}

function parseGroups(source: string): readonly Group[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | undefined;
  for (const line of source.slice(0, 1_000_000).split(/\r?\n/u)) {
    const clean = line.replace(/#.*$/u, "").trim();
    const separator = clean.indexOf(":");
    if (separator < 1) continue;
    const field = clean.slice(0, separator).trim().toLowerCase();
    const value = clean.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      if (/^(?:\*|[a-z0-9_-]+)$/iu.test(value)) current.agents.push(value.toLowerCase());
    } else if (
      current &&
      current.agents.length > 0 &&
      (field === "allow" || field === "disallow") &&
      value
    ) {
      current.rules.push({ allow: field === "allow", pattern: value });
    }
  }
  return groups;
}

function matches(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$");
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  if (!path.startsWith(pieces[0]!)) return false;
  let offset = pieces[0]!.length;
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i]!;
    if (anchored && i === pieces.length - 1) return path.endsWith(piece) && path.length - piece.length >= offset;
    const next = path.indexOf(piece, offset);
    if (next < 0) return false;
    offset = next + piece.length;
  }
  return !anchored || offset === path.length;
}

function normalizePath(value: string): string {
  return value.replace(/%([a-f0-9]{2})|[^\p{ASCII}]/giu, (value, hex: string | undefined) => {
    if (!hex) return [...Buffer.from(value)].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z0-9._~-]$/iu.test(char) ? char : `%${hex.toUpperCase()}`;
  });
}
