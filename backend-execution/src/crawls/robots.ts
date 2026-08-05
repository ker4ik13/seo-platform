export function robotsAllows(
  source: string,
  url: URL,
  crawlerToken = "seoplatformcrawler"
): boolean {
  const groups = parseGroups(source);
  const specific = groups.filter(({ agents }) =>
    agents.includes(crawlerToken.toLowerCase())
  );
  const applicable = specific.length > 0
    ? specific
    : groups.filter(({ agents }) => agents.includes("*"));
  const path = `${url.pathname}${url.search}`;
  const matching = applicable
    .flatMap(({ rules }) => rules)
    .filter(({ pattern }) => matches(path, pattern))
    .sort((left, right) => right.pattern.length - left.pattern.length);
  return matching[0]?.allow ?? true;
}

interface Group {
  readonly agents: readonly string[];
  readonly rules: readonly Rule[];
}

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
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
      current.agents.push(value.toLowerCase());
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
  const expression = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map(escapeRegex)
    .join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`, "u").test(path);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
