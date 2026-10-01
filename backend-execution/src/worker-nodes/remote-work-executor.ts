import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { technicalCrawlQueryPolicies,type TechnicalCrawlQueryPolicy,type RemoteWorkTask,type SemanticImportEncoding,type SemanticImportDelimiter,type SupportedImportMediaType,type SemanticPositionHistoryExportRow } from "@seo-platform/contracts";
import type { RemoteWorkerConfig } from "./remote-worker-config.js";
import { WorkerHttpClient,boundedBody,delay } from "./worker-http-client.js";
import { remoteProviderRequest } from "./remote-provider-request.js";
import { fetchPublicResource } from "../crawls/public-http.js";
import { analyzeCrawlResource } from "../crawls/html-analysis.js";
import { normalizedScopeUrl } from "../crawls/crawl-scope.js";
import { parseXlsxRows } from "../imports/xlsx-parser.js";
import { parseKc4Rows,type Kc4ParseMetadata } from "../imports/kc4-parser.js";
import { prepareDelimitedText,detectDelimiter,delimiterCharacter,parseDelimitedText } from "../imports/delimited-parser.js";
import { semanticExportFile,semanticFolderMapExportFile,semanticPositionHistoryExportFile,type SemanticExportKeywordRow,type SemanticFolderMapWorkbookPlan,type SemanticPositionHistoryWorkbookPlan } from "../semantic-exports/semantic-export-encoder.js";
import { internalCreateSemanticExportInput } from "../semantic-exports/semantic-export-input.js";
import { ClamdMalwareScannerAdapter } from "../malware/clamd-malware-scanner.adapter.js";
import { jsonLines } from "./remote-artifact.js";

interface Result {readonly result:Readonly<Record<string,unknown>>;readonly parts?:readonly {partNumber:number;etag:string}[];}
const encoder=new TextEncoder();
const MAX_FILE=8n*1024n**3n;

export async function executeRemoteWork(task:RemoteWorkTask,config:RemoteWorkerConfig,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<Result> {
  const client=new WorkerHttpClient(config);
  switch(task.command) {
    case "PROVIDER_HTTP":return provider(task,client,fetcher,signal);
    case "CRAWL_RESOURCE":return crawl(task,client);
    case "IMPORT_ROWS":return importRows(task,client);
    case "EXPORT_FILE":return exportFile(task,client);
    case "UPLOAD_INSPECTION":return inspectUpload(task,config);
  }
}

async function provider(task:RemoteWorkTask,client:WorkerHttpClient,fetcher:typeof fetch,signal?:AbortSignal):Promise<Result> {
  const payload=task.payload,headers=stringRecord(payload.headers),url=string(payload.url,16*1024),secrets=payload.sensitiveValues;
  if(!Array.isArray(secrets) || secrets.length!==1 || typeof secrets[0]!=="string" || secrets[0].length<8 || secrets[0].length>512) invalid();
  const key=secrets[0],parsed=new URL(url);
  const timeout=integer(payload.timeoutMs,1_000,120_000),maximum=integer(payload.maxBytes,1,128*1_048_576);
  const init={method:string(payload.method,4),headers,...(payload.body===undefined ? {} : {body:string(payload.body,2*1_048_576)})};
  remoteProviderRequest(parsed,init,{apiKey:key,...(parsed.searchParams.get("user") ? {accountIdentifier:parsed.searchParams.get("user")!} : {})},task.capability,timeout,maximum);
  if(typeof payload.admitBefore!=="string" || Date.parse(payload.admitBefore)<Date.now()) throw new WorkExecutionError("WORKER_NOT_STARTED");
  const response=await fetcher(parsed,{...init,redirect:"error",signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)});
  const body=await boundedBody(response,maximum);
  if(Buffer.from(body).toString("utf8").includes(key)) throw new WorkExecutionError("PROVIDER_SECRET_ECHO");
  const resultHeaders=Object.fromEntries(["content-type","retry-after"].flatMap(name=>response.headers.get(name) ? [[name,response.headers.get(name)!]] : []));
  const metadata={format:"HTTP",status:response.status,headers:resultHeaders};
  if(body.byteLength<=256*1024) {
    const compressed=gzipSync(body);
    if(compressed.byteLength<=32*1024) return {result:{...metadata,bodyEncoding:"GZIP",bodyBase64:compressed.toString("base64")}};
  }
  const uploaded=await upload(client,task.ticket,one(body),BigInt(maximum));
  return {result:{...metadata,artifact:uploaded.artifact},parts:uploaded.parts};
}

async function crawl(task:RemoteWorkTask,client:WorkerHttpClient):Promise<Result> {
  const payload=task.payload,options=record(payload.options),url=string(payload.url,16*1024);
  const conditional=options.conditional===undefined ? undefined : stringRecord(options.conditional);
  const types=stringArray(options.allowedContentTypes,16,120);
  let calls=0;
  const response=await fetchPublicResource(url,{
    timeoutMs:integer(options.timeoutMs,1_000,120_000),maxBytes:integer(options.maxBytes,1,128*1_048_576),maxRedirects:integer(options.maxRedirects,0,20),
    accept:string(options.accept,1_024),allowedContentTypes:types,userAgent:string(options.userAgent,1_024),
    ...(options.acceptAnyContentType===true ? {acceptAnyContentType:true} : {}),...(conditional ? {conditional} : {}),
    beforeRequest:async()=>{if(calls++>0) await delay(integer(payload.redirectDelayMs,0,60_000));}
  });
  const {body,...metadata}=response;
  if(!technicalCrawlQueryPolicies.includes(payload.queryPolicy as TechnicalCrawlQueryPolicy)) invalid();
  const analysis=payload.analyze===true ? analyzeCrawlResource(response,normalizedScopeUrl(response.finalUrl,payload.queryPolicy as TechnicalCrawlQueryPolicy)) : undefined;
  return storeJson(client,task.ticket,{format:"CRAWL_RESOURCE",response:{...metadata,bodyBase64:body.toString("base64")},...(analysis ? {analysis} : {})});
}

async function importRows(task:RemoteWorkTask,client:WorkerHttpClient):Promise<Result> {
  const payload=task.payload,format=string(payload.sourceFormat,16),size=sizeValue(payload.sourceSizeBytes);
  if(!["CSV","TSV","XLSX","KC4"].includes(format)) invalid();
  let encoding:string|undefined,delimiter:string|undefined,metadata:Kc4ParseMetadata|undefined;
  const source=download(string(payload.sourceUrl,32*1024),size);
  let rows:AsyncIterable<readonly string[]>;
  if(format==="XLSX") rows=parseXlsxRows(source,size);
  else if(format==="KC4") rows=parseKc4Rows(source,size,value=>{metadata=value;});
  else {
    const requestedEncoding=string(payload.requestedEncoding,32);if(!["AUTO","UTF_8","WINDOWS_1251"].includes(requestedEncoding)) invalid();
    const requestedDelimiter=string(payload.requestedDelimiter,32);if(!["AUTO","COMMA","SEMICOLON","TAB"].includes(requestedDelimiter)) invalid();
    const prepared=await prepareDelimitedText(source,requestedEncoding as SemanticImportEncoding);
    encoding=prepared.encoding;delimiter=detectDelimiter(prepared.sampleText,requestedDelimiter as SemanticImportDelimiter,format==="TSV" ? "TAB" : "COMMA");
    rows=parseDelimitedText(prepared.text,delimiterCharacter(delimiter as Exclude<SemanticImportDelimiter,"AUTO">));
  }
  async function* output():AsyncGenerator<Uint8Array> {
    yield encoder.encode(`${JSON.stringify({kind:"metadata",encoding,delimiter})}\n`);
    for await(const values of rows) yield encoder.encode(`${JSON.stringify({kind:"row",values})}\n`);
    yield encoder.encode(`${JSON.stringify({kind:"metadata",...(metadata ? {sourceMetadata:{groupPaths:metadata.groupPaths,groups:metadata.groups}} : {})})}\n`);
  }
  const uploaded=await upload(client,task.ticket,output(),MAX_FILE);
  return {result:{format:"IMPORT_ROWS",originalBytes:size.toString(),artifact:uploaded.artifact},parts:uploaded.parts};
}

async function exportFile(task:RemoteWorkTask,client:WorkerHttpClient):Promise<Result> {
  const payload=task.payload,raw=record(payload.input);
  const positionHistory=raw.positionHistory===undefined ? undefined : {...record(raw.positionHistory)};
  if(positionHistory) delete positionHistory.storedBefore;
  const input=internalCreateSemanticExportInput({...raw,...(positionHistory ? {positionHistory} : {})});
  const kind=string(payload.kind,16),names=stringRecord(payload.customColumnNames),now=new Date(string(payload.generatedAt,64));
  if(!Number.isFinite(now.getTime())) invalid();
  const records=jsonLines(download(string(payload.inputUrl,32*1024),sizeValue(payload.inputSizeBytes)))[Symbol.asyncIterator]();
  let count=0,pending:Record<string,unknown>|undefined;
  async function next():Promise<Record<string,unknown>|undefined> {if(pending){const value=pending;pending=undefined;return value;}const value=await records.next();return value.done ? undefined : value.value;}
  async function* rows():AsyncGenerator<SemanticExportKeywordRow> {let value;while((value=await next())){if(value.kind!=="row") invalid();count++;yield record(value.row) as unknown as SemanticExportKeywordRow;}}
  async function* history():AsyncGenerator<SemanticPositionHistoryExportRow> {let value;while((value=await next())){if(value.kind!=="row") invalid();count++;yield record(value.row) as unknown as SemanticPositionHistoryExportRow;}}
  const rowsForGroup=async function*(id:string):AsyncGenerator<SemanticExportKeywordRow>{
    const group=await next();if(!group || group.kind!=="group" || group.id!==id) invalid();let value;
    while((value=await next())){if(value.kind==="group"){pending=value;return;}if(value.kind!=="row") invalid();count++;yield record(value.row) as unknown as SemanticExportKeywordRow;}
  };
  const file=kind==="HISTORY" ? semanticPositionHistoryExportFile(history(),input,record(payload.plan) as unknown as SemanticPositionHistoryWorkbookPlan,now) :
    kind==="FOLDER_MAP" ? semanticFolderMapExportFile(rowsForGroup,input,record(payload.plan) as unknown as SemanticFolderMapWorkbookPlan,names,now) :
    kind==="ROWS" ? semanticExportFile(rows(),input,names,now) : invalid();
  const uploaded=await upload(client,task.ticket,file.bytes,MAX_FILE);
  if(count!==integer(payload.rowCount,0,10_000_000)) throw new WorkExecutionError("EXPORT_ROW_COUNT_CHANGED");
  return {result:{format:"EXPORT_FILE",filename:file.filename,contentType:file.contentType,rowCount:count,artifact:uploaded.artifact},parts:uploaded.parts};
}

async function inspectUpload(task:RemoteWorkTask,config:RemoteWorkerConfig):Promise<Result> {
  if(!config.malware) throw new WorkExecutionError("MALWARE_SCANNER_UNAVAILABLE");
  const payload=task.payload,size=sizeValue(payload.sourceSizeBytes),hash=createHash("sha256"),sample:Uint8Array[]=[];
  let bytes=0n,sampleBytes=0;
  async function* observed():AsyncGenerator<Uint8Array>{for await(const chunk of download(string(payload.sourceUrl,32*1024),size)){
    bytes+=BigInt(chunk.byteLength);hash.update(chunk);if(sampleBytes<64*1024){const part=chunk.subarray(0,64*1024-sampleBytes);sample.push(part);sampleBytes+=part.byteLength;}yield chunk;
  }}
  const verdict=await new ClamdMalwareScannerAdapter(config.malware).scan(observed());
  return {result:{format:"UPLOAD_INSPECTION",verdict,sizeBytes:bytes.toString(),checksumSha256:hash.digest("hex"),sampleBase64:Buffer.concat(sample).toString("base64"),mediaType:string(payload.sourceMediaType,255) as SupportedImportMediaType}};
}

async function upload(client:WorkerHttpClient,ticket:string,source:AsyncIterable<Uint8Array>,maximum:bigint):Promise<{artifact:{sizeBytes:string;sha256:string};parts:{partNumber:number;etag:string}[]}> {
  const initialized=record(await client.post("work/upload/init",{ticket},64*1024));
  const partSize=integer(initialized.partSizeBytes,5*1_048_576,16*1_048_576),parts:{partNumber:number;etag:string}[]=[];
  const hash=createHash("sha256");let total=0n,buffers:Buffer[]=[],buffered=0;
  async function send(body:Buffer):Promise<void>{
    const partNumber=parts.length+1,value=await client.post("work/upload/parts",{ticket,partNumbers:[partNumber]},64*1024);
    if(!Array.isArray(value) || value.length!==1) invalid();const url=string(record(value[0]).url,32*1024);
    const response=await fetch(url,{method:"PUT",body,redirect:"error",signal:AbortSignal.timeout(120_000)});
    await response.body?.cancel();const etag=response.headers.get("etag");if(!response.ok || !etag) throw new WorkExecutionError("ARTIFACT_UPLOAD_FAILED");parts.push({partNumber,etag});
  }
  for await(const chunk of source){total+=BigInt(chunk.byteLength);if(total>maximum) throw new WorkExecutionError("WORKER_ARTIFACT_TOO_LARGE");hash.update(chunk);buffers.push(Buffer.from(chunk));buffered+=chunk.byteLength;
    while(buffered>=partSize){const joined=Buffer.concat(buffers,buffered);await send(joined.subarray(0,partSize));const rest=joined.subarray(partSize);buffers=rest.length ? [rest] : [];buffered=rest.length;}}
  if(buffered || parts.length===0) await send(Buffer.concat(buffers,buffered));
  return {artifact:{sizeBytes:total.toString(),sha256:hash.digest("hex")},parts};
}

async function storeJson(client:WorkerHttpClient,ticket:string,value:Readonly<Record<string,unknown>>):Promise<Result> {
  const bytes=Buffer.from(JSON.stringify(value));if(bytes.byteLength<=256*1024) return {result:value};
  const uploaded=await upload(client,ticket,one(bytes),MAX_FILE);return {result:{format:"JSON",artifact:uploaded.artifact},parts:uploaded.parts};
}
async function* one(value:Uint8Array):AsyncGenerator<Uint8Array>{yield value;}
async function* download(value:string,expected:bigint):AsyncGenerator<Uint8Array>{
  const url=new URL(value);if(url.protocol!=="https:" || url.username || url.password || expected>MAX_FILE) invalid();
  const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(30*60_000)});if(!response.ok || !response.body) throw new WorkExecutionError("SOURCE_DOWNLOAD_FAILED");
  let bytes=0n;try{for await(const chunk of response.body){bytes+=BigInt(chunk.byteLength);if(bytes>expected) throw new WorkExecutionError("SOURCE_SIZE_MISMATCH");yield chunk;}if(bytes!==expected) throw new WorkExecutionError("SOURCE_SIZE_MISMATCH");}finally{await response.body.cancel().catch(()=>undefined);}
}
function record(value:unknown):Record<string,unknown>{if(!value || typeof value!=="object" || Array.isArray(value)) invalid();return value as Record<string,unknown>;}
function string(value:unknown,maximum:number):string{if(typeof value!=="string" || value.length>maximum) invalid();return value;}
function stringRecord(value:unknown):Record<string,string>{const row=record(value);if(Object.values(row).some(value=>typeof value!=="string")) invalid();return row as Record<string,string>;}
function stringArray(value:unknown,count:number,maximum:number):string[]{if(!Array.isArray(value) || value.length>count) invalid();return value.map(item=>string(item,maximum));}
function integer(value:unknown,minimum:number,maximum:number):number{if(typeof value!=="number" || !Number.isSafeInteger(value) || value<minimum || value>maximum) invalid();return value;}
function sizeValue(value:unknown):bigint{if(typeof value!=="string" || !/^(?:0|[1-9][0-9]{0,12})$/u.test(value)) invalid();return BigInt(value);}
export class WorkExecutionError extends Error {public constructor(public readonly code:string){super("Worker step failed");}}
function invalid():never{throw new WorkExecutionError("INVALID_WORKER_TASK");}
