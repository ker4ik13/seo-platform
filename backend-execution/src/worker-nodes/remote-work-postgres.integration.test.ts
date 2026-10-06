import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes,randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { RemoteWorkGatewayService } from "./remote-work-gateway.service.js";
import { remoteProviderRequest } from "./remote-provider-request.js";
import { remoteCredentialFingerprint } from "./remote-work-scope.js";
import type { RemoteWorkScope } from "./remote-work-client.service.js";

const databaseUrl=process.env.JOBS_REMOTE_WORK_TEST_DATABASE_URL;
test("Gateway work leases, receipts, fairness, worker loss and caller permissions",{skip:!databaseUrl,timeout:120_000},async t=>{
  const key=randomBytes(32);
  const config={databaseUrl,databasePoolMax:4,nodeEnv:"test",processRole:"HTTP",workerGatewayEnabled:true,
    integrationCredentials:{enabled:true,role:"BOTH",keys:new Map([[1,key]]),activeKeyVersion:1,fingerprintKeys:new Map([[1,key]]),activeFingerprintKeyVersion:1}} as unknown as AppConfig;
  const prisma=new PrismaService(config),crypto=new IntegrationCredentialCryptoService(config),nodes=new WorkerNodeService(prisma);
  const storage={createDownloadUrl:async()=>"https://files.example.test/scoped-object"};
  const gateway=new RemoteWorkGatewayService(prisma,nodes,crypto,storage as never,config);
  const workspaceId=randomUUID(),projectId=randomUUID(),actorId=randomUUID(),credentialId=randomUUID();
  const secret={apiKey:`fixture-${randomUUID()}`,accountIdentifier:"123456"},encrypted=crypto.encrypt(workspaceId,"XMLSTOCK",credentialId,secret);
  await prisma.integrationCredential.create({data:{id:credentialId,workspaceId,provider:"XMLSTOCK",label:"SQL fixture",mode:"BYOK_API_KEY",status:"ACTIVE",verifiedAt:new Date(),
    ciphertext:Uint8Array.from(encrypted.ciphertext),nonce:Uint8Array.from(encrypted.nonce),authTag:Uint8Array.from(encrypted.authTag),encryptedDataKey:Uint8Array.from(encrypted.encryptedDataKey),dataKeyNonce:Uint8Array.from(encrypted.dataKeyNonce),dataKeyAuthTag:Uint8Array.from(encrypted.dataKeyAuthTag),keyVersion:1,
    capabilities:["WORDSTAT"],idempotencyKey:randomUUID(),requestFingerprint:randomBytes(32),fingerprintKeyVersion:1}});
  const physical=crypto.decrypt(workspaceId,"XMLSTOCK",credentialId,encrypted).rateLimitScopeId!;
  const node=await nodes.create({name:"Gateway SQL fixture",capabilities:["WORDSTAT","EXPORT"],maxHttpSlots:8,maxCpuSlots:2,capabilityLimits:{WORDSTAT:2,EXPORT:1},useEnvCapacity:false});
  await nodes.heartbeat(node.node.id,node.token,{protocolVersion:1,httpSlots:8,rankSlots:0,cpuSlots:2,memoryBytes:8n*1024n**3n,activeWorkItems:0,capabilitySlots:{WORDSTAT:8,EXPORT:2}});
  await nodes.setEnabled(node.node.id,true);
  t.after(async()=>{await prisma.executionWorkerNode.updateMany({where:{id:node.node.id,deletedAt:null},data:{enabled:false,draining:true}});await prisma.$disconnect();});

  async function job(type="FREQUENCY_COLLECTION") {
    const id=randomUUID(),leaseOwner=`gateway-fixture:${randomUUID()}`;
    await prisma.job.create({data:{id,workspaceId,projectId,actorId,type,status:"RUNNING",stage:"collecting",credentialMode:"BYOK_API_KEY",provider:"XMLSTOCK",idempotencyScope:`fixture:${id}`,idempotencyKey:randomUUID(),correlationId:randomUUID(),
      requestHash:randomBytes(32),inputSnapshot:type==="SEMANTIC_EXPORT" ? {format:"XLSX",scope:"FULL_CORE",columns:["query"],locale:"ru"} : {types:["BASE"],regionCode:"213",device:"DESKTOP"},scopeSnapshot:{credentialId},leaseOwner,leaseExpiresAt:new Date(Date.now()+300_000),attempt:1}});
    const scope:RemoteWorkScope={origin:"JOB",workspaceId,projectId,operationId:id,jobId:id,leaseOwner,credentialId,provider:"XMLSTOCK",physicalKeyScopeId:physical,credentialFingerprint:remoteCredentialFingerprint(encrypted)};
    return {id,scope};
  }
  function payload(word:string) {const url=new URL("https://xmlstock.com/wordstat/json/");url.searchParams.set("user",secret.accountIdentifier);url.searchParams.set("key",secret.apiKey);url.searchParams.set("query",word);
    return remoteProviderRequest(url,{headers:{Accept:"application/json"}},secret,"WORDSTAT",10_000,1_048_576);}
  async function enqueue(scope:RemoteWorkScope,request:Readonly<Record<string,unknown>>) {
    const rows=await prisma.$queryRaw<{id:string;readToken:string;nodeId:string;blocked:boolean}[]>`SELECT * FROM public.enqueue_remote_work(${JSON.stringify(scope)}::jsonb,'WORDSTAT','PROVIDER_HTTP','HTTP',${JSON.stringify(request)}::jsonb,${canonicalJsonSha256("fixture",request)}::text,25000)`;
    return rows[0]!;
  }

  await t.test("new Wordstat work moves to an idle node only after existing tickets close",async()=>{
    const source=await job();
    const first=await enqueue(source.scope,payload("first fenced request") as unknown as Record<string,unknown>);
    assert.equal(first.nodeId,node.node.id);
    const idle=await nodes.create({name:"Idle Wordstat SQL fixture",capabilities:["WORDSTAT"],
      maxHttpSlots:8,maxCpuSlots:2,capabilityLimits:{WORDSTAT:8},useEnvCapacity:false});
    try {
      await nodes.heartbeat(idle.node.id,idle.token,{protocolVersion:1,httpSlots:8,rankSlots:0,cpuSlots:2,
        memoryBytes:8n*1024n**3n,activeWorkItems:0,capabilitySlots:{WORDSTAT:8}});
      await nodes.setEnabled(idle.node.id,true);
      const pinned=await enqueue(source.scope,payload("second fenced request") as unknown as Record<string,unknown>);
      assert.equal(pinned.nodeId,node.node.id,"unfinished work keeps one fenced owner");
      const claimed=await gateway.claim(node.node.id,node.token,{httpSlots:8,cpuSlots:0,capabilitySlots:{WORDSTAT:8}});
      assert.deepEqual(new Set(claimed.map(task=>task.id)),new Set([first.id,pinned.id]));
      for(const task of claimed)await gateway.complete(node.node.id,node.token,task.ticket,undefined,undefined,"WORKER_NOT_STARTED");
      await nodes.heartbeat(node.node.id,node.token,{protocolVersion:1,httpSlots:8,rankSlots:0,cpuSlots:2,
        memoryBytes:8n*1024n**3n,activeWorkItems:8,capabilitySlots:{WORDSTAT:8,EXPORT:2}});
      const switched=await enqueue(source.scope,payload("next batch on idle node") as unknown as Record<string,unknown>);
      assert.equal(switched.nodeId,idle.node.id,"the next safe batch uses the less busy node");
      const next=await gateway.claim(idle.node.id,idle.token,{httpSlots:8,cpuSlots:0,capabilitySlots:{WORDSTAT:8}});
      assert.equal(next.length,1);
      assert.equal(next[0]?.id,switched.id);
      await gateway.complete(idle.node.id,idle.token,next[0]!.ticket,undefined,undefined,"WORKER_NOT_STARTED");
    } finally {
      await nodes.remove(idle.node.id);
      await nodes.heartbeat(node.node.id,node.token,{protocolVersion:1,httpSlots:8,rankSlots:0,cpuSlots:2,
        memoryBytes:8n*1024n**3n,activeWorkItems:0,capabilitySlots:{WORDSTAT:8,EXPORT:2}});
      await prisma.job.update({where:{id:source.id},data:{status:"CANCEL_REQUESTED",cancelRequestedAt:new Date(),version:{increment:1}}});
    }
  });

  await t.test("stored envelopes are key-free; exact committed receipts survive a lost node",async()=>{
    const source=await job(),request=payload("confirmed query") as unknown as Record<string,unknown>,assignment=await enqueue(source.scope,request);
    const tasks=await gateway.claim(node.node.id,node.token,{httpSlots:8,cpuSlots:2,capabilitySlots:{WORDSTAT:8,EXPORT:2}});
    assert.equal(tasks.length,1);assert.ok(String(tasks[0]!.payload.url).includes(secret.apiKey));
    const saved=await prisma.remoteWorkTask.findUniqueOrThrow({where:{id:assignment.id}});
    assert.ok(!JSON.stringify(saved.payload).includes(secret.apiKey));
    const result={format:"HTTP",status:200,headers:{"content-type":"application/json"},bodyEncoding:"GZIP",bodyBase64:gzipSync(Buffer.from('{"totalCount":37}')).toString("base64")};
    await gateway.complete(node.node.id,node.token,tasks[0]!.ticket,result,undefined,undefined);
    await gateway.complete(node.node.id,node.token,tasks[0]!.ticket,result,undefined,undefined);
    assert.deepEqual(await gateway.receipts([{id:assignment.id,token:randomUUID()}],0),[]);
    await prisma.executionWorkerNode.update({where:{id:node.node.id},data:{lastHeartbeatAt:new Date(Date.now()-31_000)}});
    const receipt=await gateway.receipts([{id:assignment.id,token:assignment.readToken}],0);assert.equal(receipt[0]?.state,"COMPLETED");
    const recovered=await enqueue(source.scope,{...request,admitBefore:new Date().toISOString()});assert.equal(recovered.id,assignment.id);assert.equal(recovered.readToken,assignment.readToken);
    await assert.rejects(prisma.remoteWorkTask.update({where:{id:assignment.id},data:{payload:{changed:true}}}));
    await nodes.heartbeat(node.node.id,node.token,{protocolVersion:1,httpSlots:8,rankSlots:0,cpuSlots:2,memoryBytes:8n*1024n**3n,activeWorkItems:0,capabilitySlots:{WORDSTAT:8,EXPORT:2}});
    await prisma.job.update({where:{id:source.id},data:{status:"COMPLETED",finishedAt:new Date(),leaseOwner:null,leaseExpiresAt:null,version:{increment:1}}});
    assert.equal(await prisma.remoteOperationAssignment.count({where:{jobId:source.id}}),0);
  });

  await t.test("admission proves the current scope; connector role cannot read task or credential tables",async()=>{
    const source=await job(),request=payload("scoped query") as unknown as Record<string,unknown>;
    await assert.rejects(enqueue({...source.scope,workspaceId:randomUUID()},request));
    const role=`remote_caller_${randomUUID().replaceAll("-","").slice(0,12)}`;
    await prisma.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION public.enqueue_remote_work(jsonb,text,text,text,jsonb,text,integer) TO ${role}`);
    const admitted=await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);return tx.$queryRaw<{id:string}[]>`SELECT * FROM public.enqueue_remote_work(${JSON.stringify(source.scope)}::jsonb,'WORDSTAT','PROVIDER_HTTP','HTTP',${JSON.stringify(request)}::jsonb,${canonicalJsonSha256("fixture",request)}::text,25000)`;});
    assert.equal(admitted.length,1);
    await assert.rejects(prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);await tx.$queryRaw`SELECT * FROM public.remote_work_tasks`;}));
    await assert.rejects(prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);await tx.$queryRaw`SELECT ciphertext FROM public.integration_credentials`;}));
    await prisma.job.update({where:{id:source.id},data:{status:"CANCEL_REQUESTED",cancelRequestedAt:new Date(),version:{increment:1}}});
    const cancelled=await gateway.cancelled(node.node.id);assert.ok(cancelled.includes(admitted[0]!.id));
  });

  await t.test("one batch isolates a revoked lease and applies per-capability and fair operation shares",async()=>{
    const sources=await Promise.all(Array.from({length:10},()=>job()));
    const entries=sources.flatMap((source,index)=>Array.from({length:3},(_,page)=>{const request=payload(`fair ${index} ${page}`);return {scope:source.scope,capability:"WORDSTAT",command:"PROVIDER_HTTP",resource:"HTTP",payload:request,hash:canonicalJsonSha256("fixture",request),timeoutMs:25000};}));
    const invalid={...entries[0]!,scope:{...sources[0]!.scope,workspaceId:randomUUID()}};
    const rows=await prisma.$queryRaw<{ordinal:number;id:string|null;errorCode:string|null}[]>`SELECT * FROM public.enqueue_remote_work_batch(${JSON.stringify([invalid,...entries])}::jsonb)`;
    assert.equal(rows.length,31);assert.equal(rows.find(row=>row.ordinal===1)?.errorCode,"SOURCE_SCOPE_REVOKED");assert.equal(rows.filter(row=>row.id).length,30);
    const [first,second]=await Promise.all([gateway.claim(node.node.id,node.token,{httpSlots:8,cpuSlots:2,capabilitySlots:{WORDSTAT:8,EXPORT:2}}),gateway.claim(node.node.id,node.token,{httpSlots:8,cpuSlots:2,capabilitySlots:{WORDSTAT:8,EXPORT:2}})]);
    const claimed=[...first,...second];assert.equal(claimed.length,2);
    const assigned=await prisma.remoteWorkTask.findMany({where:{id:{in:claimed.map(task=>task.id)}},select:{operationId:true}});assert.equal(new Set(assigned.map(row=>row.operationId)).size,2);
    for(const source of sources)await prisma.job.update({where:{id:source.id},data:{status:"CANCEL_REQUESTED",cancelRequestedAt:new Date(),version:{increment:1}}});
    await gateway.cancelled(node.node.id);
  });

  await t.test("two ambiguous paid attempts block a third, including main fallback",async()=>{
    const source=await job(),request=payload("bounded recovery") as unknown as Record<string,unknown>;
    for(let attempt=0;attempt<2;attempt++) {
      const assigned=await enqueue(source.scope,request);assert.equal(assigned.blocked,false);
      const tasks=await gateway.claim(node.node.id,node.token,{httpSlots:8,cpuSlots:2,capabilitySlots:{WORDSTAT:8,EXPORT:2}});const task=tasks.find(row=>row.id===assigned.id);assert.ok(task);
      await gateway.complete(node.node.id,node.token,task.ticket,undefined,undefined,"WORKER_OUTCOME_UNKNOWN");
    }
    await nodes.setEnabled(node.node.id,false);
    const blocked=await enqueue(source.scope,request);assert.equal(blocked.blocked,true);assert.equal(blocked.id,null);
    await nodes.setEnabled(node.node.id,true);
  });

  await t.test("submit markers clear only with a current fenced no-send proof for all Arsenkin batch workflows",async()=>{
    const arsenkinId=randomUUID(),arsSecret={apiKey:`fixture-ars-${randomUUID()}`},arsEncrypted=crypto.encrypt(workspaceId,"ARSENKIN",arsenkinId,arsSecret);
    await prisma.integrationCredential.create({data:{id:arsenkinId,workspaceId,provider:"ARSENKIN",label:"Arsenkin fixture",mode:"BYOK_API_KEY",status:"ACTIVE",verifiedAt:new Date(),idempotencyKey:randomUUID(),capabilities:["WORDSTAT","AI_ANSWER","CLUSTERING"],requestFingerprint:randomBytes(32),fingerprintKeyVersion:1,keyVersion:1,
      ciphertext:Uint8Array.from(arsEncrypted.ciphertext),nonce:Uint8Array.from(arsEncrypted.nonce),authTag:Uint8Array.from(arsEncrypted.authTag),encryptedDataKey:Uint8Array.from(arsEncrypted.encryptedDataKey),dataKeyNonce:Uint8Array.from(arsEncrypted.dataKeyNonce),dataKeyAuthTag:Uint8Array.from(arsEncrypted.dataKeyAuthTag)}});
    await nodes.configure(node.node.id,{name:node.node.name,capabilities:["WORDSTAT","AI_ANSWER","CLUSTERING","EXPORT"],maxHttpSlots:8,maxCpuSlots:2});
    const capacities={WORDSTAT:2,AI_ANSWER:2,CLUSTERING:2,EXPORT:1};
    await nodes.heartbeat(node.node.id,node.token,{protocolVersion:1,httpSlots:8,rankSlots:0,cpuSlots:2,memoryBytes:8n*1024n**3n,activeWorkItems:0,capabilitySlots:capacities});
    for(const [type,capability,tool] of [["FREQUENCY_COLLECTION","WORDSTAT","wordstat"],["AI_ANSWER_COLLECTION","AI_ANSWER","ai-serp"],["CLUSTERING_RUN","CLUSTERING","clustering"]] as const) {
      const source=await job(type),itemId=randomUUID();
      await prisma.job.update({where:{id:source.id},data:{provider:"ARSENKIN",scopeSnapshot:{credentialId:arsenkinId}}});
      await prisma.jobItem.create({data:{id:itemId,jobId:source.id,workspaceId,projectId,sequence:1,status:"RUNNING",attempt:1,inputReference:{keywordId:randomUUID(),keywordVersion:1},providerRequestId:`submitting:${randomUUID()}`}});
      const scope={...source.scope,provider:"ARSENKIN",credentialId:arsenkinId,credentialFingerprint:remoteCredentialFingerprint(arsEncrypted),physicalKeyScopeId:crypto.decrypt(workspaceId,"ARSENKIN",arsenkinId,arsEncrypted).rateLimitScopeId ?? arsenkinId};
      const request=remoteProviderRequest(new URL("https://arsenkin.ru/api/tools/set"),{method:"POST",headers:{authorization:`Bearer ${arsSecret.apiKey}`},body:JSON.stringify({tools_name:tool,queries:["fixture"]})},arsSecret,capability,10_000,1_048_576);
      const admissions=await prisma.$queryRaw<{id:string}[]>`SELECT * FROM public.enqueue_remote_work(${JSON.stringify(scope)}::jsonb,${capability}::text,'PROVIDER_HTTP','HTTP',${JSON.stringify(request)}::jsonb,${canonicalJsonSha256("fixture",request)}::text,25000)`;
      const defer=async()=>capability==="WORDSTAT" ? prisma.$queryRaw<unknown[]>`SELECT * FROM public.defer_frequency_collection_batch_capacity(${source.id}::uuid,${[itemId]}::uuid[],${scope.leaseOwner}::text,1,5)` :
        capability==="AI_ANSWER" ? prisma.$queryRaw<unknown[]>`SELECT * FROM public.defer_ai_answer_collection_batch_capacity(${source.id}::uuid,${[itemId]}::uuid[],${scope.leaseOwner}::text,1,5)` :
          prisma.$queryRaw<unknown[]>`SELECT * FROM public.transition_clustering_run(${source.id}::uuid,${[itemId]}::uuid[],${scope.leaseOwner}::text,1,'CAPACITY',NULL,5,NULL,NULL::jsonb)`;
      assert.equal((await defer()).length,0,"an unresolved submit must never become sendable again");
      const tasks=await gateway.claim(node.node.id,node.token,{httpSlots:8,cpuSlots:2,capabilitySlots:capacities}),task=tasks.find(task=>task.id===admissions[0]?.id);assert.ok(task);
      await gateway.complete(node.node.id,node.token,task.ticket,undefined,undefined,"WORKER_NOT_STARTED");
      assert.equal((await defer()).length,1);
      const item=await prisma.jobItem.findUniqueOrThrow({where:{id:itemId}});assert.equal(item.providerRequestId,null);assert.equal(item.attempt,0);assert.equal(item.status,"FAILED_RETRYABLE");
    }
  });

  await t.test("node deletion preserves confirmed receipts, assignments history and Jobs",async()=>{
    const historical = await prisma.remoteWorkTask.findFirstOrThrow({where:{nodeId:node.node.id,state:"COMPLETED"}});
    const jobsBefore=await prisma.job.count(),tasksBefore=await prisma.remoteWorkTask.count();
    const removed=await nodes.remove(node.node.id);
    assert.deepEqual(await nodes.remove(node.node.id),removed);
    assert.ok(!(await nodes.list()).some(row=>row.id===node.node.id));
    await assert.rejects(nodes.authenticateForCompletion(node.node.id,node.token));
    await assert.rejects(nodes.setEnabled(node.node.id,true));
    await assert.rejects(prisma.executionWorkerNode.update({where:{id:node.node.id},data:{enabled:true}}));
    assert.equal((await gateway.receipts([{id:historical.id,token:historical.leaseToken}],0))[0]?.state,"COMPLETED");
    assert.equal(await prisma.job.count(),jobsBefore);assert.equal(await prisma.remoteWorkTask.count(),tasksBefore);
  });

  await t.test("one healthy node claims and receives 64 independent provider items",async()=>{
    const batchNode=await nodes.create({name:"Gateway batch fixture",capabilities:["WORDSTAT"],
      maxHttpSlots:64,maxCpuSlots:2,capabilityLimits:{WORDSTAT:64},useEnvCapacity:false});
    await nodes.heartbeat(batchNode.node.id,batchNode.token,{protocolVersion:1,httpSlots:64,rankSlots:0,cpuSlots:2,
      memoryBytes:8n*1024n**3n,activeWorkItems:0,capabilitySlots:{WORDSTAT:64}});
    await nodes.setEnabled(batchNode.node.id,true);
    try {
      const source=await job();
      const entries=Array.from({length:64},(_,index)=>{
        const request=payload(`batch ${index}`);
        return {scope:source.scope,capability:"WORDSTAT",command:"PROVIDER_HTTP",resource:"HTTP",
          payload:request,hash:canonicalJsonSha256("fixture",request),timeoutMs:25000};
      });
      const admitted=await prisma.$queryRaw<{id:string}[]>`SELECT * FROM public.enqueue_remote_work_batch(${JSON.stringify(entries)}::jsonb)`;
      assert.equal(admitted.length,64);
      const tasks=await gateway.claim(batchNode.node.id,batchNode.token,{httpSlots:64,cpuSlots:0,capabilitySlots:{WORDSTAT:64}});
      assert.equal(tasks.length,64);
      assert.equal(new Set(tasks.map(task=>task.id)).size,64);
      assert.ok(tasks.every(task=>String(task.payload.url).includes(secret.apiKey)));
      for(const task of tasks)await gateway.complete(batchNode.node.id,batchNode.token,task.ticket,undefined,undefined,"WORKER_NOT_STARTED");
      await prisma.job.update({where:{id:source.id},data:{status:"CANCEL_REQUESTED",cancelRequestedAt:new Date(),version:{increment:1}}});
    } finally {
      await nodes.remove(batchNode.node.id);
    }
  });
});
