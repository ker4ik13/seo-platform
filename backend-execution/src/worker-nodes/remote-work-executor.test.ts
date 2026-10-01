import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { WorkerCapability, RemoteWorkTask } from "@seo-platform/contracts";
import { parseRemoteWorkTask } from "@seo-platform/contracts";
import { executeRemoteWork, WorkExecutionError } from "./remote-work-executor.js";
import { remoteProviderRequest, materializeRemoteProviderRequest,REMOTE_PROVIDER_ADMISSION_MS } from "./remote-provider-request.js";
import type { RemoteWorkerConfig } from "./remote-worker-config.js";
import { signRemoteWorkTicket, verifyRemoteWorkTicket } from "./remote-work-ticket.js";
import { RemoteProviderTransportService } from "./remote-provider-transport.service.js";
import { RemoteWorkFailedError } from "./remote-work-client.service.js";

const secret = { apiKey: "fixture-api-key-never-requested", accountIdentifier: "123456" };
const config = { controlUrl: new URL("https://control.example.test"), token: `wn_${"a".repeat(43)}`, nodeId: randomUUID() } as RemoteWorkerConfig;

function work(capability: WorkerCapability, provider: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO"): RemoteWorkTask {
  const url = provider === "XMLSTOCK" ? new URL(`https://xmlstock.com/${capability === "RANK" ? "yandexlive/xml" : "wordstat/json"}/`) :
    new URL(provider === "ARSENKIN" ? "https://arsenkin.ru/api/tools/set" : "https://api.keys.so/report/simple/organic/keywords");
  if (provider === "XMLSTOCK") { url.searchParams.set("user", secret.accountIdentifier); url.searchParams.set("key", secret.apiKey); url.searchParams.set("query", "fixture"); }
  const init = provider === "ARSENKIN" ? { method: "POST", headers: { authorization: `Bearer ${secret.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ tools_name: ({ RANK: "positions", WORDSTAT: "wordstat", RESEARCH: "wordstat", AI_ANSWER: "ai-serp", CLUSTERING: "clustering" } as Partial<Record<WorkerCapability,string>>)[capability] }) } :
    { headers: provider === "KEYS_SO" ? { "x-keyso-token": secret.apiKey } : { accept: "application/json" } };
  const request = remoteProviderRequest(url, init, secret, capability, 10_000, 1_048_576);
  assert.ok(!JSON.stringify(request).includes(secret.apiKey));
  return parseRemoteWorkTask({ schemaVersion: "worker-work-task@1", id: randomUUID(), ticket: "test-ticket", capability, command: "PROVIDER_HTTP", resource: "HTTP", payload: materializeRemoteProviderRequest(request, secret), deadline: new Date(Date.now()+25_000).toISOString() });
}

test("all provider capabilities run once with bounded, secret-free receipts", async () => {
  for (const [capability, provider] of [
    ["RANK","XMLSTOCK"], ["RANK","ARSENKIN"], ["WORDSTAT","XMLSTOCK"], ["WORDSTAT","ARSENKIN"],
    ["RESEARCH","XMLSTOCK"], ["RESEARCH","ARSENKIN"], ["RESEARCH","KEYS_SO"], ["AI_ANSWER","ARSENKIN"], ["CLUSTERING","ARSENKIN"]
  ] as const) {
    let calls = 0;
    const task = work(capability, provider);
    const result = await executeRemoteWork(task, config, async (_url, init) => {
      calls++; assert.equal(init?.redirect, "error");
      return new Response('{"result":"fixture","totalCount":42}', { status: 200, headers: { "content-type":"application/json" } });
    });
    assert.equal(calls, 1); assert.equal(result.result.status, 200);
    assert.equal(gunzipSync(Buffer.from(String(result.result.bodyBase64), "base64")).toString(), '{"result":"fixture","totalCount":42}');
    assert.ok(!JSON.stringify(result).includes(secret.apiKey));
  }
});

test("late admission and a secret echo never issue a second provider request", async () => {
  const task = work("WORDSTAT", "XMLSTOCK");
  let calls = 0;
  await assert.rejects(executeRemoteWork({ ...task, payload: { ...task.payload, admitBefore: new Date(Date.now()-1).toISOString() } }, config, async () => { calls++; return new Response("{}"); }), (error: unknown) => error instanceof WorkExecutionError && error.code === "WORKER_NOT_STARTED");
  assert.equal(calls, 0);
  await assert.rejects(executeRemoteWork(task, config, async () => { calls++; return new Response(secret.apiKey); }), (error: unknown) => error instanceof WorkExecutionError && error.code === "PROVIDER_SECRET_ECHO");
  assert.equal(calls, 1);
});

test("a mixed claim can deliver a paid request before its admission window closes", async () => {
  for(const sample of [
    {provider:"XMLSTOCK" as const,capability:"WORDSTAT" as const,
      url:new URL("https://xmlstock.com/wordstat/json/?user=123456&key=fixture-api-key-never-requested&query=fixture"),init:undefined},
    {provider:"ARSENKIN" as const,capability:"CLUSTERING" as const,
      url:new URL("https://arsenkin.ru/api/tools/set"),init:{method:"POST",headers:{authorization:`Bearer ${secret.apiKey}`},body:JSON.stringify({tools_name:"clustering",queries:["fixture"]})}}
  ]) {
    const before=Date.now();
    const request=remoteProviderRequest(sample.url,sample.init,secret,sample.capability,10_000,1_048_576);
    assert.ok(Date.parse(request.admitBefore)-before>=REMOTE_PROVIDER_ADMISSION_MS-100);
    assert.ok(Date.parse(request.admitBefore)-before<=REMOTE_PROVIDER_ADMISSION_MS+100);
    let ownerTimeout=0;
    const transport=new RemoteProviderTransportService({enabled:()=>true,execute:async (...args:unknown[])=>{
      ownerTimeout=(args[4] as {timeoutMs:number}).timeoutMs;
      return new Response("{}");
    }} as never,{} as never);
    await transport.run({origin:"JOB",workspaceId:randomUUID(),operationId:randomUUID(),provider:sample.provider,credentialId:randomUUID()},sample.capability,async()=>{
      transport.useSecret(secret);
      return transport.fetcher(sample.url,sample.init);
    });
    assert.equal(ownerTimeout,10_000+REMOTE_PROVIDER_ADMISSION_MS+15_000);
  }
});

test("a lost Arsenkin check acknowledgement falls back to a safe local read, never a second paid set", async t => {
  const native=globalThis.fetch;
  t.after(()=>{globalThis.fetch=native;});
  let localReads=0;
  globalThis.fetch=async()=>{localReads++;return new Response("{}",{status:200,headers:{"content-type":"application/json"}});};
  const transport=new RemoteProviderTransportService({enabled:()=>true,execute:async()=>{
    throw new RemoteWorkFailedError("WORKER_OUTCOME_UNKNOWN");
  }} as never,{} as never);
  const scope={origin:"JOB" as const,workspaceId:randomUUID(),operationId:randomUUID(),provider:"ARSENKIN" as const,credentialId:randomUUID()};
  const call=(path:string,body:Record<string,unknown>)=>transport.run(scope,"CLUSTERING",async()=>{
    transport.useSecret(secret);
    return transport.fetcher(new URL(`https://arsenkin.ru/api/tools/${path}`),{
      method:"POST",headers:{authorization:`Bearer ${secret.apiKey}`},body:JSON.stringify(body)
    });
  });
  assert.equal((await call("check",{task_id:"fixture"})).status,200);
  assert.equal(localReads,1);
  await assert.rejects(call("set",{tools_name:"clustering",queries:["fixture"]}),
    (error:unknown)=>error instanceof RemoteWorkFailedError && error.code==="WORKER_OUTCOME_UNKNOWN");
  assert.equal(localReads,1);
});

test("a signed work ticket binds the node, immutable payload, lease and deadline", () => {
  const ticketConfig = { integrationCredentials: { activeKeyVersion: 1, keys: new Map([[1,randomBytes(32)]]) } } as unknown as AppConfig;
  const value = { id: randomUUID(), nodeId: config.nodeId, leaseToken: randomUUID(), payloadHash: "a".repeat(64), expiresAt: new Date(Date.now()+60_000).toISOString() };
  const ticket = signRemoteWorkTicket(ticketConfig, value);
  assert.equal(verifyRemoteWorkTicket(ticketConfig, ticket, config.nodeId).leaseToken, value.leaseToken);
  assert.throws(() => verifyRemoteWorkTicket(ticketConfig, ticket, randomUUID()));
  assert.throws(() => verifyRemoteWorkTicket(ticketConfig, `${ticket}x`, config.nodeId));
  assert.throws(() => verifyRemoteWorkTicket(ticketConfig, signRemoteWorkTicket(ticketConfig, { ...value, expiresAt: new Date(Date.now()-1).toISOString() }), config.nodeId));
});

test("a large valid provider batch keeps the local path instead of becoming a transport failure", async (t) => {
  const native = globalThis.fetch;
  t.after(() => { globalThis.fetch = native; });
  const body = JSON.stringify({ tools_name: "clustering", queries: Array.from({ length: 5000 }, () => "query ".repeat(35)) });
  assert.ok(Buffer.byteLength(body) > 896 * 1024);
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(init?.body, body); return new Response("{}"); };
  const transport = new RemoteProviderTransportService({ enabled: () => true, execute: async () => { assert.fail("large input must not enter the database envelope"); } } as never, {} as never);
  const response = await transport.run({ origin: "JOB", workspaceId: randomUUID(), operationId: randomUUID(), provider: "ARSENKIN", credentialId: randomUUID() }, "CLUSTERING", async () => {
    transport.useSecret(secret);
    return transport.fetcher(new URL("https://arsenkin.ru/api/tools/set"), { method: "POST", body, headers: { authorization: `Bearer ${secret.apiKey}` } });
  });
  assert.equal(response.status, 200); assert.equal(calls, 1);
});
