export interface SiteStructureNode {
  readonly name: string;
  readonly path: string;
  readonly count: number;
  readonly depth: number;
  readonly children: readonly SiteStructureNode[];
}

export function buildSiteStructure(
  urls: readonly string[]
): Readonly<{ total: number; nodes: readonly SiteStructureNode[] }> {
  interface MutableNode {
    name: string;
    path: string;
    count: number;
    depth: number;
    children: Map<string, MutableNode>;
  }
  const roots = new Map<string, MutableNode>();
  for (const value of urls) {
    let pathname: string;
    try {
      pathname = new URL(value).pathname;
    } catch {
      continue;
    }
    const segments = pathname.split("/").filter(Boolean);
    let children = roots;
    let path = "";
    for (const [index, segment] of segments.entries()) {
      path += `/${segment}`;
      const key = `${path}/`;
      let node = children.get(key);
      if (!node) {
        node = {
          name: decodedPathSegment(segment),
          path: key,
          count: 0,
          depth: index + 1,
          children: new Map()
        };
        children.set(key, node);
      }
      node.count += 1;
      children = node.children;
    }
  }
  const freeze = (values: Iterable<MutableNode>): readonly SiteStructureNode[] =>
    [...values]
      .sort((left, right) =>
        left.name.localeCompare(right.name, "ru", { numeric: true })
      )
      .map((node) => ({
        name: node.name,
        path: node.path,
        count: node.count,
        depth: node.depth,
        children: freeze(node.children.values())
      }));
  return { total: urls.length, nodes: freeze(roots.values()) };
}

function decodedPathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
