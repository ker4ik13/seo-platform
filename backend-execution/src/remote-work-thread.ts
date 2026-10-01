import { parentPort,workerData } from "node:worker_threads";
import { executeRemoteWork,WorkExecutionError } from "./worker-nodes/remote-work-executor.js";
import { WorkerHttpClient,WorkerAuthenticationError } from "./worker-nodes/worker-http-client.js";
import type { RemoteWorkerConfig } from "./worker-nodes/remote-worker-config.js";
import { parseRemoteWorkTask } from "@seo-platform/contracts";

const task=parseRemoteWorkTask(workerData.task);
const config={...workerData.config,controlUrl:new URL(workerData.config.controlUrl)} as RemoteWorkerConfig;
const client=new WorkerHttpClient(config);
try {
  const completed=await executeRemoteWork(task,config);
  await client.complete(task.ticket,completed.result,completed.parts);
  parentPort?.postMessage({ok:true});
} catch(error) {
  const raw=error && typeof error==="object" && "code" in error ? error.code : undefined;
  const code=error instanceof WorkExecutionError ? error.code : typeof raw==="string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(raw) ? raw : "WORKER_EXECUTION_FAILED";
  let authenticationRejected=error instanceof WorkerAuthenticationError;
  try {await client.complete(task.ticket,undefined,undefined,code);} catch(completionError) {authenticationRejected ||= completionError instanceof WorkerAuthenticationError;}
  parentPort?.postMessage({ok:false,code,authenticationRejected});
}
