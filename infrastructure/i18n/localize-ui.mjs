import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const compiler = process.env.SEO_PLATFORM_I18N_TYPESCRIPT;
if (!compiler) throw new Error('Set SEO_PLATFORM_I18N_TYPESCRIPT to a development TypeScript compiler API');
const { default: ts } = await import(pathToFileURL(compiler).href);
const root = process.cwd();
const apply = process.argv.includes('--apply');
const catalog = new Map();
const skipped = [];
const files=[];
for (const dir of ['frontend/components','frontend/app/app','frontend/app/admin']) walk(path.join(root,dir));
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(f.endsWith('.tsx')&&!f.endsWith('/ui-locale.tsx'))files.push(f);}}
const attributeNames = new Set(['title','description','label','aria-label','aria-description','ariaLabel','placeholder','emptyLabel','emptyMessage','loadingLabel','buttonLabel','caption','alt','hint','searchPlaceholder','clearLabel','backLabel','confirmLabel','cancelLabel']);
let editedFiles=0, replacements=0;
for(const file of files){
 const text=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const client=sf.statements.some(s=>ts.isExpressionStatement(s)&&ts.isStringLiteral(s.expression)&&s.expression.text==='use client');
 const edits=[];const needed=new Set();const hooks=new Set();const native=new Map();
 const add=(start,end,value)=>edits.push({start,end,value});
 function key(value){const k=value.replace(/\s+/gu,' ').trim();if(!k||!/[а-яё]/iu.test(k))return; const entry=catalog.get(k)??{text:k,files:[]};const rel=path.relative(root,file);if(!entry.files.includes(rel))entry.files.push(rel);catalog.set(k,entry);return k;}
 function component(n){for(let p=n.parent;p;p=p.parent){if(ts.isFunctionLike(p)&&p.body&&ts.isBlock(p.body)){let name=p.name?.getText(sf);if(!name&&ts.isVariableDeclaration(p.parent))name=p.parent.name.getText(sf);if(name&&/^[A-Z]/u.test(name))return p;}}}
 function inCode(n){for(let p=n.parent;p;p=p.parent){if(ts.isJsxElement(p)){const tag=p.openingElement.tagName.getText(sf);if(['code','pre','script','style','UiText','UiElement'].includes(tag))return true;}}return false;}
 function descriptor(n){
  if(ts.isParenthesizedExpression(n)) return descriptor(n.expression);
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)){const k=key(n.text);return k?{text:k,values:[],before:/^\s/u.test(n.text)?' ':'',after:/\s$/u.test(n.text)?' ':''}:undefined;}
  if(ts.isTemplateExpression(n)){let pattern=n.head.text;const values=[];for(const span of n.templateSpans){pattern+=`{${values.length}}${span.literal.text}`;values.push(`String(${span.expression.getText(sf)})`);}const k=key(pattern);return k?{text:k,values,before:/^\s/u.test(pattern)?' ':'',after:/\s$/u.test(pattern)?' ':''}:undefined;}
 }
 function message(d){needed.add('UiText');return `<UiText text=${JSON.stringify(d.text)}${d.values.length?` values={[${d.values.join(', ')}]}`:''}${d.before?' before=" "':''}${d.after?' after=" "':''} />`;}
 function uiCall(n, fn){const d=descriptor(n);if(d){hooks.add(fn);needed.add('useUiLocale');return `uiText(${JSON.stringify(d.text)}${d.values.length?`, [${d.values.join(', ')}]`:''})`;}
  if(ts.isConditionalExpression(n)){const a=uiCall(n.whenTrue,fn),b=uiCall(n.whenFalse,fn);if(a||b)return `${n.condition.getText(sf)} ? ${a??n.whenTrue.getText(sf)} : ${b??n.whenFalse.getText(sf)}`;}
 }
 function child(n){const d=descriptor(n);if(d){add(n.getStart(sf),n.end,message(d));return;}if(ts.isConditionalExpression(n)){child(n.whenTrue);child(n.whenFalse);}else if(ts.isBinaryExpression(n)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind))child(n.right);}
 function visit(n){
  if(inCode(n))return;
  if(ts.isJsxText(n)&&/[а-яё]/iu.test(n.text)){const normalized=reactText(n.text),k=key(normalized);if(k){add(n.getStart(sf),n.end,message({text:k,values:[],before:/^\s/u.test(normalized)?' ':'',after:/\s$/u.test(normalized)?' ':''}));}return;}
  if(ts.isJsxExpression(n)&&n.expression&&!ts.isJsxAttribute(n.parent)){child(n.expression);}
  if(ts.isJsxAttribute(n)&&n.initializer&&attributeNames.has(n.name.getText(sf))){
   const opening=n.parent.parent,tag=opening.tagName.getText(sf);
   if(['UiText','UiElement'].includes(tag))return;
   const expression=ts.isJsxExpression(n.initializer)?n.initializer.expression:n.initializer;
   if(expression){const owner=client?component(n):undefined;
    if(owner){const translated=uiCall(expression,owner);if(translated)add(n.initializer.getStart(sf),n.initializer.end,`{${translated}}`);}
    else {const d=descriptor(expression);if(d){if(/^[a-z]/u.test(tag)){const record=native.get(opening)??{tag,attrs:[]};record.attrs.push({name:n.name.getText(sf),d});native.set(opening,record);add(n.getStart(sf),n.end,'');}else skipped.push({file:path.relative(root,file),tag,attribute:n.name.getText(sf),text:d.text});}}
   }
  }
  ts.forEachChild(n,visit);
 }
 visit(sf);
 for(const [opening,item] of native){needed.add('UiElement');add(opening.tagName.getStart(sf),opening.tagName.end,'UiElement');const labels=item.attrs.map(({name,d})=>`${JSON.stringify(name)}: ${d.values.length?`{ text: ${JSON.stringify(d.text)}, values: [${d.values.join(', ')}] }`:JSON.stringify(d.text)}`).join(', ');add(opening.tagName.end,opening.tagName.end,` tag=${JSON.stringify(item.tag)} uiLabels={{${labels}}}`);if(ts.isJsxOpeningElement(opening)){const closing=opening.parent.closingElement;add(closing.tagName.getStart(sf),closing.tagName.end,'UiElement');}}
 for(const fn of hooks){if(/\buiText\b/u.test(fn.body.getText(sf)))throw new Error(`Existing uiText in ${file}`);add(fn.body.getStart(sf)+1,fn.body.getStart(sf)+1,'\n  const { t: uiText } = useUiLocale();');}
 if(edits.length){
  const imported=new Set();for(const s of sf.statements){if(ts.isImportDeclaration(s)&&ts.isStringLiteral(s.moduleSpecifier)&&s.moduleSpecifier.text.endsWith('ui-locale')&&s.importClause?.namedBindings&&ts.isNamedImports(s.importClause.namedBindings))for(const e of s.importClause.namedBindings.elements)imported.add(e.name.text);}
  const missing=[...needed].filter(n=>!imported.has(n));if(missing.length){const target=path.relative(path.dirname(file),path.join(root,'frontend/components/ui-locale')).split(path.sep).join('/');const lastImport=[...sf.statements].filter(ts.isImportDeclaration).at(-1);const at=lastImport?.end??sf.statements[0]?.getStart(sf)??0;add(at,at,`\nimport { ${missing.join(', ')} } from ${JSON.stringify(target.startsWith('.')?target:`./${target}`)};\n`);}
  edits.sort((a,b)=>b.start-a.start||b.end-a.end);let previous=text.length+1;let output=text;
  for(const e of edits){if(e.end>previous)throw new Error(`Overlapping localization edits in ${file} at ${e.start}`);output=output.slice(0,e.start)+e.value+output.slice(e.end);previous=e.start;}
  if(apply)fs.writeFileSync(file,output);editedFiles++;replacements+=edits.length;
 }
}
fs.mkdirSync(path.join(root,'docs/i18n'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/i18n/ui-catalog.json'),JSON.stringify([...catalog.values()],null,2)+'\n');
fs.writeFileSync(path.join(root,'docs/i18n/manual-attributes.json'),JSON.stringify(skipped,null,2)+'\n');
console.log(JSON.stringify({apply,editedFiles,replacements,keys:catalog.size,manualAttributes:skipped.length}));
function reactText(raw){const lines=raw.split(/\r\n|\n|\r/u);let last=0;for(let i=0;i<lines.length;i++)if(/[^ \t]/u.test(lines[i]))last=i;let out='';for(let i=0;i<lines.length;i++){let line=lines[i].replace(/\t/gu,' ');if(i!==0)line=line.replace(/^ +/u,'');if(i!==lines.length-1)line=line.replace(/ +$/u,'');if(line){out+=line;if(i!==last)out+=' ';}}return out;}
