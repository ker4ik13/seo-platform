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
import { remoteWorkerClaimDelayMs } from "./worker-nodes/remote-worker-claim-cadence.js";

const CLAIM_CADENCE_CHECK_MS=100;

async function main():Promise<void> {
  const config=await loadRemoteWorkerConfig(),client=new WorkerHttpClient(config),controller=new AbortController();
  process.once("SIGINT",()=>controller.abort());process.once("SIGTERM",()=>controller.abort());
  const active=new Map<WorkerCapability,number>();let httpActive=0,cpuActive=0,inspectionReady=false,authenticationRejected=false;
  let effectiveCapacity = {
    httpSlots: config.httpSlots,
    cpuSlots: config.cpuSlots,
    capabilitySlots: config.capabilitySlots
  };
  const running=new Set<Promise<void>>();let completedWork=0;
  const cancellations=new Map<string,()=>void>();
  const suspendAuthentication=()=>{authenticationRejected=true;for(const stop of cancellations.values())stop();};
  const capacities=()=>({...effectiveCapacity.capabilitySlots,
    INSPECTION:inspectionReady ? effectiveCapacity.capabilitySlots.INSPECTION ?? 0 : 0});

  async function heartbeat():Promise<void> {
    let previous="";
    while(!controller.signal.aborted) {
      try {
        if(config.malware) {try{await new ClamdMalwareScannerAdapter(config.malware).healthCheck();inspectionReady=true;}catch{inspectionReady=false;}}
        const node=parseWorkerNodeView(await client.post("heartbeat",{protocolVersion:1,httpSlots:config.httpSlots,rankSlots:config.rankSlots,cpuSlots:config.cpuSlots,
          memoryBytes:String(Math.min(totalmem(),process.constrainedMemory() || totalmem())),activeWorkItems:httpActive+cpuActive,
          capabilitySlots:{...config.capabilitySlots,INSPECTION:inspectionReady ? config.capabilitySlots.INSPECTION ?? 0 : 0}},64*1024,5_000,controller.signal));
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
        if(state!==previous) {process.stdout.write(`worker ${config.nodeId} ${state}\n`);previous=state;}
      } catch(error) {
        if(controller.signal.aborted) break;
        const state=error instanceof WorkerAuthenticationError ? "authentication rejected" : "control plane unavailable";
        if(state!==previous){process.stderr.write(`worker ${config.nodeId} ${state}\n`);previous=state;}
        if(error instanceof WorkerAuthenticationError) suspendAuthentication();
      }
      await wait(authenticationRejected ? 30_000 : config.heartbeatMs,controller.signal);
    }
  }

  function start(capability:WorkerCapability,resource:"HTTP"|"CPU",action:()=>Promise<void>):void {
    active.set(capability,(active.get(capability) ?? 0)+1);if(resource==="HTTP")httpActive++;else cpuActive++;
    const work=action().catch(error=>{if(error instanceof WorkerAuthenticationError){process.stderr.write(`worker ${config.nodeId} authentication rejected\n`);suspendAuthentication();}
      else process.stderr.write(`worker ${config.nodeId} result acknowledgement unavailable\n`);
    }).finally(()=>{active.set(capability,Math.max(0,(active.get(capability) ?? 1)-1));if(resource==="HTTP")httpActive--;else cpuActive--;running.delete(work);completedWork++;});
    running.add(work);
  }

  async function schedule():Promise<void> {
    let lastPoll=0,observedCompletions=0;
    while(!controller.signal.aborted) {
      while(!controller.signal.aborted) {
        const delay=remoteWorkerClaimDelayMs(lastPoll,observedCompletions,completedWork,Date.now());
        if(delay===0)break;
        await wait(Math.min(delay,CLAIM_CADENCE_CHECK_MS),controller.signal);
      }
      if(controller.signal.aborted)break;
      observedCompletions=completedWork;
      lastPoll=Date.now();
      if(authenticationRejected) continue;
      const httpSlots=Math.max(0,effectiveCapacity.httpSlots-httpActive),cpuSlots=Math.max(0,effectiveCapacity.cpuSlots-cpuActive);
      const slots=Object.fromEntries(workerCapabilities.map(capability=>[capability,Math.max(0,(capacities()[capability] ?? 0)-(active.get(capability) ?? 0))]));
      try {
        const value=await client.post("claim",{httpSlots,cpuSlots,capabilitySlots:slots},32*1_048_576,30_000,controller.signal);
        if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).length!==3) throw new Error("Invalid claim batch");
        const batch=value as {work?:unknown;ranks?:unknown;cancelled?:unknown};if(!Array.isArray(batch.work) || !Array.isArray(batch.ranks) || !Array.isArray(batch.cancelled) || batch.cancelled.length>256 || batch.cancelled.some(id=>typeof id!=="string") || batch.work.length+batch.ranks.length>640) throw new Error("Invalid claim batch");
        for(const id of batch.cancelled)cancellations.get(id)?.();
        const tasks=batch.work.map(parseRemoteWorkTask),ranks=batch.ranks.map(parseWorkerRankTask);
        if(tasks.filter(task=>task.resource==="HTTP").length+ranks.length>httpSlots || tasks.filter(task=>task.resource==="CPU").length>cpuSlots) throw new Error("Worker capacity exceeded");
        for(const task of tasks) start(task.capability,task.resource,()=>{
          const done=()=>cancellations.delete(task.id);
          if(task.resource==="CPU") return runCpu(task,config,client,stop=>cancellations.set(task.id,stop)).finally(done);
          const abort=new AbortController();cancellations.set(task.id,()=>abort.abort());return runWork(task,config,client,abort.signal).finally(done);
        });
        for(const task of ranks) start("RANK","HTTP",()=>runRank(task,client));
      } catch(error) {
        if(controller.signal.aborted)break;
        if(error instanceof WorkerAuthenticationError){suspendAuthentication();await wait(5_000,controller.signal);}
        if(error instanceof WorkerPausedError) await wait(5_000,controller.signal);
      }
    }
    await Promise.allSettled(running);
  }
  await Promise.all([heartbeat(),schedule()]);
}

async function runWork(task:RemoteWorkTask,config:RemoteWorkerConfig,client:WorkerHttpClient,signal:AbortSignal):Promise<void> {
  let result;
  try {result=await executeRemoteWork(task,config,fetch,signal);}
  catch(error){const code=error instanceof WorkExecutionError ? error.code : error && typeof error==="object" && "code" in error && typeof error.code==="string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code) ? error.code : "WORKER_OUTCOME_UNKNOWN";await client.complete(task.ticket,undefined,undefined,code);return;}
  await client.complete(task.ticket,result.result,result.parts);
}

async function runCpu(task:RemoteWorkTask,config:RemoteWorkerConfig,client:WorkerHttpClient,register:(stop:()=>void)=>void):Promise<void> {
  await new Promise<void>((resolve,reject)=>{
    const worker=new CpuWorker(new URL("./remote-work-thread.js",import.meta.url),{workerData:{task,config:{...config,controlUrl:config.controlUrl.toString()}},resourceLimits:{maxOldGenerationSizeMb:config.cpuTaskMemoryMb}});
    register(()=>{void worker.terminate();});
    let settled=false;
    const timer=setTimeout(()=>{void worker.terminate();},Math.max(1_000,Date.parse(task.deadline)-Date.now()+5_000));
    worker.once("message",(message:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();const authentication=message && typeof message==="object" && "authenticationRejected" in message && message.authenticationRejected===true;if(authentication)reject(new WorkerAuthenticationError());else resolve();});
    worker.once("error",()=>{if(settled)return;settled=true;clearTimeout(timer);void client.complete(task.ticket,undefined,undefined,"WORKER_PROCESS_EXITED").then(()=>resolve(),reject);});
    worker.once("exit",()=>{if(settled)return;settled=true;clearTimeout(timer);void client.complete(task.ticket,undefined,undefined,"WORKER_PROCESS_EXITED").then(()=>resolve(),reject);});
  });
}

async function runRank(task:RemoteRankPollTaskV1,client:WorkerHttpClient):Promise<void> {
  const outcome=await new XmlStockRankConnector(fetch,task.softId).fetchResult(task.providerTaskId,task.secret,task.timeoutMs,rankProviderRequestIntent(task.requestSnapshot),task.providerProgress);
  const body={schemaVersion:"worker-rank-poll-result@1",ticket:task.ticket,requestSnapshot:task.requestSnapshot,outcome};
  for(let attempt=0;attempt<3;attempt++){try{await client.post("rank/complete",body,64*1024,10_000);return;}catch(error){if(error instanceof WorkerAuthenticationError || attempt===2)throw error;await wait(500*(attempt+1),new AbortController().signal);}}
}

function wait(milliseconds:number,signal:AbortSignal):Promise<void>{return new Promise(resolve=>{if(signal.aborted)return resolve();const finished=()=>{clearTimeout(timer);signal.removeEventListener("abort",finished);resolve();};const timer=setTimeout(finished,milliseconds);signal.addEventListener("abort",finished,{once:true});});}

void main().catch(error=>{
  const diagnostic=error instanceof RemoteWorkerConfigurationError
    ? `remote worker configuration rejected: ${error.message}`
    : "remote worker failed to start";
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode=1;
});
