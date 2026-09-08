// Adds explicit locale propagation to display formatters. Search, canonical
// values, keyword languages and case folding are deliberately excluded.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { default: ts } = await import(pathToFileURL(process.env.SEO_PLATFORM_I18N_TYPESCRIPT).href);
const apply = process.argv.includes("--apply");
const roots = [];
function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.resolve(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.tsx?$/u.test(f) && !/\.test\.|\.generated\.|ui-translations|ui-locale/u.test(f)) roots.push(f); } }
for (const dir of ["frontend/components", "frontend/app/app", "frontend/app/admin", "frontend/lib"]) walk(dir);
const program = ts.createProgram(roots, { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve, skipLibCheck: true });
const checker = program.getTypeChecker();
const functions = new Map(), calls = [], literals = [], marked = new Set(), skipped = [];
const rootSet = new Set(roots);
const sources = program.getSourceFiles().filter(sf => rootSet.has(sf.fileName));
function nameOf(node) { if (ts.isFunctionDeclaration(node)) return node.name?.text; if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text; }
function ownerOf(node) { for (let p = node.parent; p; p = p.parent) if (functions.has(p)) return p; }
for (const sf of sources) {
  function visit(n) { const name = nameOf(n); if (name) functions.set(n, { name, sf, component: /^[A-Z]/u.test(name) && sf.fileName.endsWith(".tsx") }); ts.forEachChild(n, visit); } visit(sf);
}
for (const sf of sources) {
  function visit(n) {
    if (ts.isStringLiteral(n) && n.text === "ru-RU") {
      const p = n.parent;
      const isFormat = ts.isNewExpression(p) && /^Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat)$/u.test(p.expression.getText(sf)) || ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && /^toLocale(?:String|DateString|TimeString)$/u.test(p.expression.name.text);
      if (isFormat && p.arguments?.[0] === n) { const owner = ownerOf(n); if (owner) { literals.push({ node: n, owner, sf }); marked.add(owner); } else skipped.push(n.getText(sf)); }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      let symbol = checker.getSymbolAtLocation(n.expression);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      let declaration = symbol?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration)) declaration = declaration.initializer;
      if (functions.has(declaration)) calls.push({ node: n, target: declaration, owner: ownerOf(n), sf });
    }
    ts.forEachChild(n, visit);
  } visit(sf);
}
let grew = true;
while (grew) { grew = false; for (const call of calls) if (marked.has(call.target) && !functions.get(call.target).component && call.owner && !marked.has(call.owner)) { marked.add(call.owner); grew = true; } }
const edits = new Map();
function edit(sf, start, end, text) { const list = edits.get(sf) ?? []; list.push({ start, end, text }); edits.set(sf, list); }
for (const { node, sf } of literals) edit(sf, node.getStart(sf), node.end, "uiLocale");
const hookFiles = new Set();
for (const node of marked) {
  const { sf, component } = functions.get(node);
  if (component) {
    if (!ts.isBlock(node.body)) throw new Error(`Component with concise body: ${sf.fileName}`);
    edit(sf, node.body.getStart(sf) + 1, node.body.getStart(sf) + 1, '\n  const uiLocale = useUiLocale().locale;'); hookFiles.add(sf);
  } else {
    if (node.parameters.some(p => p.dotDotDotToken)) throw new Error(`Rest parameter formatter: ${sf.fileName}`);
    const last = node.parameters.at(-1);
    const at = last?.end ?? node.parameters.pos;
    edit(sf, at, at, `${last ? ", " : ""}uiLocale: string = "ru-RU"`);
  }
}
for (const { node, target, owner, sf } of calls) if (marked.has(target) && !functions.get(target).component) {
  if (!owner) { skipped.push(`Top-level call ${node.getText(sf)}`); continue; }
  const last = node.arguments.at(-1), at = last?.end ?? node.arguments.pos;
  const missing = Math.max(0, target.parameters.length - node.arguments.length);
  edit(sf, at, at, `${last ? ", " : ""}${"undefined, ".repeat(missing)}uiLocale`);
}
for (const sf of hookFiles) {
  const imported = sf.statements.some(s => ts.isImportDeclaration(s) && s.moduleSpecifier.text.endsWith("ui-locale") && s.importClause?.namedBindings?.elements?.some(e => e.name.text === "useUiLocale"));
  if (!imported) { const specifier = path.relative(path.dirname(sf.fileName), path.resolve("frontend/components/ui-locale")).split(path.sep).join("/"); const at = sf.statements.filter(ts.isImportDeclaration).at(-1)?.end ?? 0; edit(sf, at, at, `\nimport { useUiLocale } from ${JSON.stringify(specifier.startsWith(".") ? specifier : `./${specifier}`)};\n`); }
}
for (const [sf, list] of edits) {
  let output = sf.text, previous = output.length + 1;
  for (const e of list.sort((a, b) => b.start - a.start || b.end - a.end)) { if (e.end > previous) throw new Error(`Overlapping edit: ${sf.fileName}`); output = output.slice(0, e.start) + e.text + output.slice(e.end); previous = e.start; }
  if (apply) fs.writeFileSync(sf.fileName, output);
}
process.stdout.write(JSON.stringify({ files: edits.size, formatSites: literals.length, functions: marked.size, skipped, apply }) + "\n");
