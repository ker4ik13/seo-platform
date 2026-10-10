import type { SiteStructureNode } from "./site-structure";

export interface PageMapDrawNode {
  readonly node: SiteStructureNode;
  readonly parent?: string;
  readonly x: number;
  readonly y: number;
  readonly pageId?: string;
}

export const PAGE_MAP_NODE_WIDTH = 236;
export const PAGE_MAP_NODE_HEIGHT = 110;
const COLUMN_GAP = 44;
const ROW_GAP = 38;
const CHILD_GAP = 60;

export function sortSiteSections(nodes: readonly SiteStructureNode[]): readonly SiteStructureNode[] {
  return [...nodes].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ru", { numeric: true }));
}

interface BranchBox {
  readonly width: number;
  readonly height: number;
  readonly children: readonly SiteStructureNode[];
  readonly columns: readonly number[];
  readonly rows: readonly number[];
}

/** Measure once, then place each expanded node once. Large sibling lists wrap without page limits. */
export function pageMapLayout(nodes: readonly SiteStructureNode[], domain: string, total: number, pageIds: ReadonlyMap<string, string>, expansion: Readonly<Record<string, boolean>>) {
  const root: SiteStructureNode = { path: "/", name: domain, depth: 0, count: total, children: nodes };
  const output: PageMapDrawNode[] = [{ node: root, x: 20, y: 0, ...(pageIds.has("/") ? { pageId: pageIds.get("/")! } : {}) }];
  const boxes = new Map<string, BranchBox>();
  function measure(node: SiteStructureNode): BranchBox {
    const children = expansion[node.path] === false ? [] : sortSiteSections(node.children);
    const count = Math.min(6, Math.ceil(Math.sqrt(children.length)));
    const columns = Array<number>(count).fill(0), rows = Array<number>(count ? Math.ceil(children.length / count) : 0).fill(0);
    children.forEach((child, index) => {
      const box = measure(child), column = index % count, row = Math.floor(index / count);
      columns[column] = Math.max(columns[column]!, box.width);
      rows[row] = Math.max(rows[row]!, box.height);
    });
    const width = Math.max(PAGE_MAP_NODE_WIDTH, columns.reduce((sum, value) => sum + value, 0) + Math.max(0, count - 1) * COLUMN_GAP);
    const height = PAGE_MAP_NODE_HEIGHT + (children.length ? CHILD_GAP + rows.reduce((sum, value) => sum + value, 0) + (rows.length - 1) * ROW_GAP : 0);
    const box = { width, height, children, columns, rows };
    boxes.set(node.path, box);
    return box;
  }
  function place(node: SiteStructureNode, left: number, top: number, parent: string) {
    const box = boxes.get(node.path)!;
    output.push({ node, parent, x: left + (box.width - PAGE_MAP_NODE_WIDTH) / 2, y: top, ...(pageIds.has(node.path) ? { pageId: pageIds.get(node.path)! } : {}) });
    let rowTop = top + PAGE_MAP_NODE_HEIGHT + CHILD_GAP;
    for (let row = 0; row < box.rows.length; row++) {
      let columnLeft = left;
      for (let column = 0; column < box.columns.length; column++) {
        const child = box.children[row * box.columns.length + column];
        if (child) place(child, columnLeft + (box.columns[column]! - boxes.get(child.path)!.width) / 2, rowTop, node.path);
        columnLeft += box.columns[column]! + COLUMN_GAP;
      }
      rowTop += box.rows[row]! + ROW_GAP;
    }
  }
  let branchX = 20;
  if (expansion["/"] !== false) for (const branch of sortSiteSections(nodes)) {
    const box = measure(branch);
    place(branch, branchX, 170, "/");
    branchX += box.width + COLUMN_GAP;
  }
  return { nodes: output, width: Math.max(300, ...output.map((item) => item.x + PAGE_MAP_NODE_WIDTH + 20)), height: Math.max(170, ...output.map((item) => item.y + PAGE_MAP_NODE_HEIGHT + 20)) };
}
