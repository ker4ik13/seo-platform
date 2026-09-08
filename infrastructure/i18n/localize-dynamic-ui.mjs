// One-time migration helper for explicitly identified UI presentation functions.
// It never marks arbitrary .name/.label/.text values from user records.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { default: ts } = await import(pathToFileURL(process.env.SEO_PLATFORM_I18N_TYPESCRIPT).href);
const apply = process.argv.includes("--apply");
const files = [];
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (file.endsWith(".tsx") && !file.endsWith("ui-locale.tsx")) files.push(file); } }
for (const dir of ["frontend/components", "frontend/app/app", "frontend/app/admin"]) walk(dir);
const presentation = /^(?:roleLabel|projectStatusLabel|credentialStatusLabel|subscriptionStatus|paymentStatus|receiptStatus|refundRequestLabel|queuePriorityLabel|eventLabel|channelLabel|severityLabel|deliveryModeLabel|jobTypeLabel|operationTypeLabel|jobStatusLabel|statusLabel|stageLabel|sourceLabel|intentLabel|deviceLabel|searchEngineLabel|integrationCapabilityLabel|integrationCredentialModeLabel|connectorRoutingScopeLabel|connectorAttemptReasonLabel|connectorAttemptOutcomeLabel|fieldErrorMessage|errorMessage|notificationErrorMessage|invitationStatusLabel|projectRoleLabel|workspaceStatusLabel)$/u;
const uiState = /^(?:error|notice|message|success|[a-zA-Z]*(?:Message|Error|Notice))$/u;
let changed = 0;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  function parentTag(node) { for (let p = node.parent; p; p = p.parent) if (ts.isJsxElement(p)) return p.openingElement.tagName.getText(sf); }
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent) && !["UiText", "code", "pre", "script", "style"].includes(parentTag(node))) {
      const expression = node.expression;
      if ((ts.isIdentifier(expression) && uiState.test(expression.text)) || (ts.isPropertyAccessExpression(expression) && expression.name.text === "message") || (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && (presentation.test(expression.expression.text) || (/Label$/u.test(expression.expression.text) && !/^(?:group|context|user|project|member|keyword|date|name|folder)Label$/u.test(expression.expression.text))))) {
        edits.push({ start: expression.getStart(sf), end: expression.end, text: `<UiText text={${expression.getText(sf)} ?? ""} />` });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!edits.length) continue;
  const imported = sf.statements.some(s => ts.isImportDeclaration(s) && s.moduleSpecifier.text.endsWith("ui-locale") && s.importClause?.namedBindings?.elements?.some(e => e.name.text === "UiText"));
  if (!imported) { const specifier = path.relative(path.dirname(file), "frontend/components/ui-locale").split(path.sep).join("/"); const at = sf.statements.filter(ts.isImportDeclaration).at(-1)?.end ?? 0; edits.push({ start: at, end: at, text: `\nimport { UiText } from ${JSON.stringify(specifier.startsWith(".") ? specifier : `./${specifier}`)};\n` }); }
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (apply) fs.writeFileSync(file, output);
  changed += edits.length;
}
process.stdout.write(`Explicit dynamic UI edits: ${changed}, applied: ${apply}\n`);
