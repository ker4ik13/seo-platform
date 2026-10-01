import { createHash } from "node:crypto";
import { RemoteWorkFailedError } from "./remote-work-client.service.js";

export async function* remoteArtifact(result:Readonly<Record<string,unknown>>,maximum:bigint):AsyncGenerator<Uint8Array> {
  const artifact=record(result.artifact);
  if(typeof result.artifactUrl!=="string" || typeof artifact.sizeBytes!=="string" || !/^(?:0|[1-9][0-9]{0,12})$/u.test(artifact.sizeBytes) ||
    typeof artifact.sha256!=="string" || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) invalid();
  const url=new URL(result.artifactUrl); if(url.protocol!=="https:" || url.username || url.password) invalid();
  const expected=BigInt(artifact.sizeBytes); if(expected>maximum) invalid();
  const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(15*60_000)});
  if(!response.ok || !response.body) { await response.body?.cancel(); invalid(); }
  let bytes=0n;const hash=createHash("sha256");
  try {
    for await(const chunk of response.body) { bytes+=BigInt(chunk.byteLength);if(bytes>expected || bytes>maximum) invalid();hash.update(chunk);yield chunk; }
    if(bytes!==expected || hash.digest("hex")!==artifact.sha256) invalid();
  } finally { await response.body.cancel().catch(()=>undefined); }
}

export async function remoteJson(result:Readonly<Record<string,unknown>>,maximum=32*1_048_576):Promise<Readonly<Record<string,unknown>>> {
  if(result.format!=="JSON") return result;
  const parts:Buffer[]=[];for await(const chunk of remoteArtifact(result,BigInt(maximum))) parts.push(Buffer.from(chunk));
  let value:unknown;try {value=JSON.parse(Buffer.concat(parts).toString("utf8"));} catch {invalid();}
  return record(value);
}

export async function* jsonLines(source:AsyncIterable<Uint8Array>,maximumLineBytes=32*1_048_576):AsyncGenerator<Record<string,unknown>> {
  const decoder=new TextDecoder();let pending="";
  for await(const chunk of source) {
    pending+=decoder.decode(chunk,{stream:true});
    let end:number;
    while((end=pending.indexOf("\n"))>=0) {const line=pending.slice(0,end);pending=pending.slice(end+1);if(Buffer.byteLength(line)>maximumLineBytes) invalid();if(line) {let parsed:unknown;try {parsed=JSON.parse(line);} catch {invalid();}yield record(parsed);} }
    if(Buffer.byteLength(pending)>maximumLineBytes) invalid();
  }
  pending+=decoder.decode();if(pending.trim()) {let parsed:unknown;try {parsed=JSON.parse(pending);} catch {invalid();}yield record(parsed);}
}

function record(value:unknown):Record<string,unknown> {if(!value || typeof value!=="object" || Array.isArray(value)) invalid();return value as Record<string,unknown>;}
function invalid():never {throw new RemoteWorkFailedError("INVALID_WORKER_ARTIFACT");}
