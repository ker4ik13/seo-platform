import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { WorkerCapability } from "@seo-platform/contracts";

const KEY = "__gateway_api_key__";
const ACCOUNT = "__gateway_account_id__";
// The control plane can spend up to 20 seconds collecting a mixed rank/work
// batch. Keep the paid request fenced, but do not expire it before delivery.
export const REMOTE_PROVIDER_ADMISSION_MS = 30_000;
const allowedPaths: Readonly<Record<string, readonly string[]>> = {
  "xmlstock.com": ["/yandex/xml/","/yandexlive/xml/","/google/xml/","/wordstat/json/"],
  "arsenkin.ru": ["/api/tools/set","/api/tools/check","/api/tools/get"],
  "api.keys.so": ["/report/simple/organic/keywords","/report/simple/domain_dashboard"]
};

export interface RemoteProviderRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string,string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly admitBefore: string;
}

export function remoteProviderRequest(urlValue: string | URL | Request, init: RequestInit | undefined,
  secret: IntegrationCredentialSecret, capability: WorkerCapability, timeoutMs: number, maxBytes: number): RemoteProviderRequest {
  const url = providerUrl(urlValue instanceof Request ? urlValue.url : String(urlValue));
  for (const [name,value] of url.searchParams) {
    if (value === secret.apiKey) url.searchParams.set(name,KEY);
    else if (secret.accountIdentifier && value === secret.accountIdentifier && name === "user") url.searchParams.set(name,ACCOUNT);
  }
  const headers: Record<string,string> = {};
  for (const [name,value] of new Headers(init?.headers)) {
    if (!["accept","content-type","authorization","x-keyso-token"].includes(name)) invalid();
    headers[name] = value === secret.apiKey ? KEY : value === `Bearer ${secret.apiKey}` ? `Bearer ${KEY}` : value;
  }
  if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") invalid();
  const input: RemoteProviderRequest = { url:url.toString(),method:(init?.method ?? "GET") as "GET"|"POST",headers,
    ...(typeof init?.body === "string" ? { body:init.body } : {}),timeoutMs,maxBytes,admitBefore:new Date(Date.now()+REMOTE_PROVIDER_ADMISSION_MS).toISOString() };
  if (JSON.stringify(input).includes(secret.apiKey)) invalid();
  return validateRemoteProviderRequest(input,capability);
}

export function validateRemoteProviderRequest(value: unknown, capability: WorkerCapability): RemoteProviderRequest {
  const row = record(value);
  const fields = ["url","method","headers","timeoutMs","maxBytes","admitBefore",...(Object.hasOwn(row,"body") ? ["body"] : [])];
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row,key)) || typeof row.url !== "string" ||
    !["GET","POST"].includes(String(row.method)) || !integer(row.timeoutMs,1_000,120_000) ||
    !integer(row.maxBytes,1,128*1_048_576) || typeof row.admitBefore !== "string" || !Number.isFinite(Date.parse(row.admitBefore)) ||
    (row.body !== undefined && (typeof row.body !== "string" || Buffer.byteLength(row.body)>2_097_152))) invalid();
  const url = providerUrl(row.url);
  const headers = record(row.headers);
  if (Object.entries(headers).some(([name,header]) => !["accept","content-type","authorization","x-keyso-token"].includes(name) || typeof header !== "string" || header.length>1_024)) invalid();
  if (url.hostname === "xmlstock.com") {
    if (row.method !== "GET" || url.searchParams.get("key") !== KEY || url.searchParams.get("user") !== ACCOUNT ||
      !(capability === "RANK" ? url.pathname !== "/wordstat/json/" : ["WORDSTAT","RESEARCH"].includes(capability) && url.pathname === "/wordstat/json/")) invalid();
  } else if (url.hostname === "arsenkin.ru") {
    if (row.method !== "POST" || headers.authorization !== `Bearer ${KEY}` || typeof row.body !== "string") invalid();
    let body: Record<string,unknown>; try { body=record(JSON.parse(row.body)); } catch { invalid(); }
    if (url.pathname === "/api/tools/set") {
      const names: Readonly<Partial<Record<WorkerCapability,readonly string[]>>> = { RANK:["positions","check-top"],WORDSTAT:["wordstat"],RESEARCH:["wordstat"],AI_ANSWER:["ai-serp"],CLUSTERING:["clustering"] };
      if (!names[capability]?.includes(String(body.tools_name))) invalid();
    } else if (!["RANK","WORDSTAT","RESEARCH","AI_ANSWER","CLUSTERING"].includes(capability)) invalid();
  } else if (url.hostname === "api.keys.so") {
    if (row.method !== "GET" || capability !== "RESEARCH" || headers["x-keyso-token"] !== KEY) invalid();
  }
  return row as unknown as RemoteProviderRequest;
}

export function materializeRemoteProviderRequest(input: RemoteProviderRequest, secret: IntegrationCredentialSecret): Readonly<Record<string,unknown>> {
  const url = providerUrl(input.url);
  for (const [name,value] of url.searchParams) {
    if (value === KEY) url.searchParams.set(name,secret.apiKey);
    if (value === ACCOUNT) { if (!secret.accountIdentifier) invalid(); url.searchParams.set(name,secret.accountIdentifier); }
  }
  const headers = Object.fromEntries(Object.entries(input.headers).map(([key,value]) => [key,value === KEY ? secret.apiKey : value === `Bearer ${KEY}` ? `Bearer ${secret.apiKey}` : value]));
  return { ...input,url:url.toString(),headers,sensitiveValues:[secret.apiKey] };
}

function providerUrl(value: string): URL {
  let url: URL; try { url=new URL(value); } catch { invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port || !allowedPaths[url.hostname]?.includes(url.pathname)) invalid();
  return url;
}
function record(value: unknown): Record<string,unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string,unknown>; }
function integer(value: unknown,min:number,max:number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value>=min && value<=max; }
function invalid(): never { throw new TypeError("Invalid delegated provider request"); }
