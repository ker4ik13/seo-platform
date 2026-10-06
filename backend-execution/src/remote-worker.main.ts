import "dotenv/config";
import { totalmem } from "node:os";
import { Worker as CpuWorker } from "node:worker_threads";
import { parseWorkerNodeView,parseRemoteWorkTask,workerCapabilities,type RemoteRankPollTaskV1,type RemoteWorkTask,type WorkerCapability } from "@seo-platform/contracts";
import { loadRemoteWorkerConfig,RemoteWorkerConfigurationError,type RemoteWorkerConfig } from "./worker-nodes/remote-worker-config.js";
import { WorkerHttpClient,WorkerAuthenticationError,WorkerPausedError } from "./worker-nodes/worker-http-client.js";
import { executeRemoteWork,WorkExecutionError } from "./worker-nodes/remote-work-executor.js";
import { parseWorkerRankTask } from "./worker-nodes/worker-rank-task.js";
import { rankProviderRequestIntent } from "./rank-runs/rank-provider-request-intent.js";
import { XmlStockRankConnector } from "./rank-runs/xmlstock-rank.connector.js";
import { ClamdMalwareScannerAdapter } from "./malware/clamd-malware-scanner.adapter.js";
import { REMOTE_WORKER_WARM_POLLS, remoteWorkerClaimDelayMs, remoteWorkerFamilyHttpSlots } from "./worker-nodes/remote-worker-claim-cadence.js";
import { workerTaskFinishLog, workerTaskLogContext, workerTaskStartLog } from "./worker-nodes/remote-worker-task-log.js";
import { workerBuildHash } from "./worker-nodes/worker-build-version.js";
import { keepHeartbeatUntilDrained } from "./worker-nodes/remote-worker-lifecycle.js";
import { WorkerRankResultBatcher } from "./worker-nodes/worker-rank-result-batcher.js";

const CLAIM_CADENCE_CHECK_MS=100;
const HTTP_WORK_CAPABILITIES=workerCapabilities.filter(capability=>
  capability!=="RANK" && !["IMPORT","EXPORT","INSPECTION"].includes(capability));
const CPU_WORK_CAPABILITIES=workerCapabilities.filter(capability=>
  ["IMPORT","EXPORT","INSPECTION"].includes(capability));

async function main():Promise<void> {
  const config=await loadRemoteWorkerConfig(),buildHash=await workerBuildHash(),client=new WorkerHttpClient(config),claimController=new AbortController(),heartbeatController=new AbortController();
  const rankResults=new WorkerRankResultBatcher(client);
  process.stdout.write(`Воркер: сборка ${buildHash.slice(0,12)}\n`);
  process.once("SIGINT",()=>claimController.abort());process.once("SIGTERM",()=>claimController.abort());
  const active=new Map<WorkerCapability,number>();let httpActive=0,cpuActive=0,inspectionReady=false,authenticationRejected=false;
  let effectiveCapacity = {
    httpSlots: config.httpSlots,
    cpuSlots: config.cpuSlots,
    capabilitySlots: config.capabilitySlots
  };
  const running=new Set<Promise<void>>();
  const completed={work:0,rank:0};
  const reserved={work:0,rank:0};
  const cancellations=new Map<string,()=>void>();
  const suspendAuthentication=()=>{authenticationRejected=true;for(const stop of cancellations.values())stop();};
  const capacities=()=>({...effectiveCapacity.capabilitySlots,
    INSPECTION:inspectionReady ? effectiveCapacity.capabilitySlots.INSPECTION ?? 0 : 0});

  async function heartbeat():Promise<void> {
    let previous="";
    while(!heartbeatController.signal.aborted) {
      try {
        if(config.malware) {try{await new ClamdMalwareScannerAdapter(config.malware).healthCheck();inspectionReady=true;}catch{inspectionReady=false;}}
        const node=parseWorkerNodeView(await client.post("heartbeat",{protocolVersion:1,httpSlots:config.httpSlots,rankSlots:config.rankSlots,cpuSlots:config.cpuSlots,
          memoryBytes:String(Math.min(totalmem(),process.constrainedMemory() || totalmem())),activeWorkItems:httpActive+cpuActive,
          capabilitySlots:{...config.capabilitySlots,INSPECTION:inspectionReady ? config.capabilitySlots.INSPECTION ?? 0 : 0},buildHash},64*1024,5_000,heartbeatController.signal));
        if(node.id!==config.nodeId || node.protocolVersion!==1) throw new Error("Invalid worker identity");
        effectiveCapacity = {
          httpSlots: node.maxHttpSlots,
          cpuSlots: node.maxCpuSlots,
          capabilitySlots: Object.fromEntries(workerCapabilities.map(capability => {
            const cpu = ["IMPORT", "EXPORT", "INSPECTION"].includes(capability);
            const parent = cpu ? node.maxCpuSlots : node.maxHttpSlots;
            const requested = node.capabilityLimits?.[capability] ?? config.capabilitySlots[capability] ?? 0;
            return [capability, Math.min(parent, requested)];
          })) as Readonly<Partial<Record<WorkerCapability, number>>>
        };
        authenticationRejected=false;
        const state=node.enabled ? node.draining ? "draining" : "online" : "disabled";
        const stateLabel=state==="online" ? "на связи" : state==="draining" ? "завершает задачи" : "выключен";
        if(state!==previous) {process.stdout.write(`Воркер ${config.nodeId}: ${stateLabel}\n`);previous=state;}
      } catch(error) {
        if(heartbeatController.signal.aborted) break;
        const state=error instanceof WorkerAuthenticationError ? "authentication rejected" : "control plane unavailable";
        if(state!==previous){process.stderr.write(`worker ${config.nodeId} ${state} · Воркер: ${error instanceof WorkerAuthenticationError ? "аутентификация отклонена" : "центр временно недоступен"}\n`);previous=state;}
        if(error instanceof WorkerAuthenticationError) suspendAuthentication();
      }
      await wait(authenticationRejected ? 30_000 : config.heartbeatMs,heartbeatController.signal);
    }
  }

  function start(task:RemoteWorkTask|RemoteRankPollTaskV1,resource:"HTTP"|"CPU",action:()=>Promise<string|undefined>):void {
    const capability=task.schemaVersion==="worker-rank-poll-task@1" ? "RANK" : task.capability;
    const context=workerTaskLogContext(task,config.logQueries),startedAt=Date.now();
    process.stdout.write(`${workerTaskStartLog(context)}\n`);
    active.set(capability,(active.get(capability) ?? 0)+1);if(resource==="HTTP")httpActive++;else cpuActive++;
    const work=action().then(errorCode=>{
      process.stdout.write(`${workerTaskFinishLog(context,Date.now()-startedAt,errorCode)}\n`);
    }).catch(error=>{if(error instanceof WorkerAuthenticationError){process.stderr.write(`worker ${config.nodeId} authentication rejected · Воркер: не удалось подтвердить ${context}\n`);suspendAuthentication();}
      else process.stderr.write(`Воркер: центр не подтвердил ${context} · ${Date.now()-startedAt} мс\n`);
    }).finally(()=>{active.set(capability,Math.max(0,(active.get(capability) ?? 1)-1));if(resource==="HTTP")httpActive--;else cpuActive--;running.delete(work);completed[capability==="RANK" ? "rank" : "work"]++;});
    running.add(work);
  }

  async function scheduleFamily(family:"work"|"rank"):Promise<void> {
    let lastPoll=0,observedCompletions=0,warmPollsRemaining=0;
    while(!claimController.signal.aborted) {
      while(!claimController.signal.aborted) {
        if(completed[family]>observedCompletions)warmPollsRemaining=REMOTE_WORKER_WARM_POLLS;
        const delay=remoteWorkerClaimDelayMs(lastPoll,observedCompletions,completed[family],Date.now(),warmPollsRemaining);
        if(delay===0)break;
        await wait(Math.min(delay,CLAIM_CADENCE_CHECK_MS),claimController.signal);
      }
      if(claimController.signal.aborted)break;
      observedCompletions=completed[family];
      lastPoll=Date.now();
      if(authenticationRejected) continue;
      const currentCapacities=capacities();
      const rankCapacity=Math.max(0,(currentCapacities.RANK ?? 0)-(active.get("RANK") ?? 0));
      const workCapacity=Math.max(0,...HTTP_WORK_CAPABILITIES.map(capability=>
        (currentCapacities[capability] ?? 0)-(active.get(capability) ?? 0)));
      const cpuCapacity=Math.max(0,...CPU_WORK_CAPABILITIES.map(capability=>
        (currentCapacities[capability] ?? 0)-(active.get(capability) ?? 0)));
      const available=Math.max(0,effectiveCapacity.httpSlots-httpActive-reserved.work-reserved.rank);
      const ownCapability=family==="rank" ? rankCapacity : workCapacity;
      const otherCapability=family==="rank" ? workCapacity : rankCapacity;
      const httpSlots=ownCapability>0 ? remoteWorkerFamilyHttpSlots(available,otherCapability) : 0;
      const cpuSlots=family==="work" ? Math.min(cpuCapacity,Math.max(0,effectiveCapacity.cpuSlots-cpuActive)) : 0;
      if(httpSlots===0 && cpuSlots===0){await wait(250,claimController.signal);continue;}
      reserved[family]=httpSlots;
      const slots=Object.fromEntries(workerCapabilities.map(capability=>[capability,
        (family==="rank")===(capability==="RANK") ? Math.max(0,(currentCapacities[capability] ?? 0)-(active.get(capability) ?? 0)) : 0]));
      try {
        const claimStartedAt=Date.now();
        const value=await client.post("claim",{httpSlots,cpuSlots,capabilitySlots:slots},32*1_048_576,30_000,claimController.signal);
        if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).length!==3) throw new Error("Invalid claim batch");
        const batch=value as {work?:unknown;ranks?:unknown;cancelled?:unknown};if(!Array.isArray(batch.work) || !Array.isArray(batch.ranks) || !Array.isArray(batch.cancelled) || batch.cancelled.length>256 || batch.cancelled.some(id=>typeof id!=="string") || batch.work.length+batch.ranks.length>640) throw new Error("Invalid claim batch");
        for(const id of batch.cancelled)cancellations.get(id)?.();
        const tasks=batch.work.map(parseRemoteWorkTask),ranks=batch.ranks.map(parseWorkerRankTask);
        warmPollsRemaining=tasks.length+ranks.length>0 ? REMOTE_WORKER_WARM_POLLS : Math.max(0,warmPollsRemaining-1);
        if(tasks.filter(task=>task.resource==="HTTP").length+ranks.length>httpSlots || tasks.filter(task=>task.resource==="CPU").length>cpuSlots) throw new Error("Worker capacity exceeded");
        if(tasks.length+ranks.length>0)process.stdout.write(`Воркер: получена пачка · задания ${tasks.length} · страницы позиций ${ranks.length} · выдача ${Date.now()-claimStartedAt} мс\n`);
        for(const task of tasks) start(task,task.resource,()=>{
          const done=()=>cancellations.delete(task.id);
          if(task.resource==="CPU") return runCpu(task,config,client,stop=>cancellations.set(task.id,stop)).finally(done);
          const abort=new AbortController();cancellations.set(task.id,()=>abort.abort());return runWork(task,config,client,abort.signal).finally(done);
        });
        for(const task of ranks) start(task,"HTTP",()=>runRank(task,rankResults));
      } catch(error) {
        if(claimController.signal.aborted)break;
        if(error instanceof WorkerAuthenticationError){suspendAuthentication();await wait(5_000,claimController.signal);}
        if(error instanceof WorkerPausedError) await wait(5_000,claimController.signal);
      } finally {
        reserved[family]=0;
      }
    }
  }
  await keepHeartbeatUntilDrained(heartbeatController,heartbeat(),async()=>{
    await Promise.all([scheduleFamily("work"),scheduleFamily("rank")]);
    await Promise.allSettled(running);
  });
}

async function runWork(task:RemoteWorkTask,config:RemoteWorkerConfig,client:WorkerHttpClient,signal:AbortSignal):Promise<string|undefined> {
  let result;
  try {result=await executeRemoteWork(task,config,fetch,signal);}
  catch(error){const code=error instanceof WorkExecutionError ? error.code : error && typeof error==="object" && "code" in error && typeof error.code==="string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code) ? error.code : "WORKER_OUTCOME_UNKNOWN";await client.complete(task.ticket,undefined,undefined,code);return code;}
  await client.complete(task.ticket,result.result,result.parts);
  return undefined;
}

async function runCpu(task:RemoteWorkTask,config:RemoteWorkerConfig,client:WorkerHttpClient,register:(stop:()=>void)=>void):Promise<string|undefined> {
  return new Promise<string|undefined>((resolve,reject)=>{
    const worker=new CpuWorker(new URL("./remote-work-thread.js",import.meta.url),{workerData:{task,config:{...config,controlUrl:config.controlUrl.toString()}},resourceLimits:{maxOldGenerationSizeMb:config.cpuTaskMemoryMb}});
    register(()=>{void worker.terminate();});
    let settled=false;
    const timer=setTimeout(()=>{void worker.terminate();},Math.max(1_000,Date.parse(task.deadline)-Date.now()+5_000));
    worker.once("message",(message:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();const row=message && typeof message==="object" ? message as Record<string,unknown> : {};if(row.authenticationRejected===true)reject(new WorkerAuthenticationError());else resolve(row.ok===true ? undefined : typeof row.code==="string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(row.code) ? row.code : "WORKER_EXECUTION_FAILED");});
    worker.once("error",()=>{if(settled)return;settled=true;clearTimeout(timer);void client.complete(task.ticket,undefined,undefined,"WORKER_PROCESS_EXITED").then(()=>resolve("WORKER_PROCESS_EXITED"),reject);});
    worker.once("exit",()=>{if(settled)return;settled=true;clearTimeout(timer);void client.complete(task.ticket,undefined,undefined,"WORKER_PROCESS_EXITED").then(()=>resolve("WORKER_PROCESS_EXITED"),reject);});
  });
}

async function runRank(task:RemoteRankPollTaskV1,results:WorkerRankResultBatcher):Promise<string|undefined> {
  const outcome=await new XmlStockRankConnector(fetch,task.softId).fetchResult(task.providerTaskId,task.secret,task.timeoutMs,rankProviderRequestIntent(task.requestSnapshot),task.providerProgress);
  await results.complete({schemaVersion:"worker-rank-poll-result@1",ticket:task.ticket,requestSnapshot:task.requestSnapshot,outcome});
  return undefined;
}

function wait(milliseconds:number,signal:AbortSignal):Promise<void>{return new Promise(resolve=>{if(signal.aborted)return resolve();const finished=()=>{clearTimeout(timer);signal.removeEventListener("abort",finished);resolve();};const timer=setTimeout(finished,milliseconds);signal.addEventListener("abort",finished,{once:true});});}

void main().catch(error=>{
  const diagnostic=error instanceof RemoteWorkerConfigurationError
    ? `Воркер: неверная конфигурация: ${error.message}`
    : "Воркер: запуск не удался";
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode=1;
});
