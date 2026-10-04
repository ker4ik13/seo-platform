import type { RemoteWorkerConfig } from "./remote-worker-config.js";

export class WorkerAuthenticationError extends Error { public constructor(){super("Worker authentication rejected");} }
export class WorkerPausedError extends Error { public constructor(){super("Worker node is paused");} }
export class WorkerTaskClosedError extends Error { public constructor(){super("Worker task is closed");} }
export class WorkerRouteNotFoundError extends Error { public constructor(){super("Worker route is unavailable");} }

export class WorkerHttpClient {
  public constructor(private readonly config:RemoteWorkerConfig) {}
  public async post(route:string,body:unknown,maximumBytes=16*1_048_576,timeoutMs=30_000,signal?:AbortSignal):Promise<unknown> {
    const response=await fetch(new URL(`/worker/v1/${route}`,this.config.controlUrl),{
      method:"POST",headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${this.config.token}`,"X-Worker-Id":this.config.nodeId},
      body:JSON.stringify(body),redirect:"error",signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
    if(response.status===401) {await response.body?.cancel();throw new WorkerAuthenticationError();}
    if(response.status===403 && route.includes("claim")) {await response.body?.cancel();throw new WorkerPausedError();}
    if(response.status===409 && route.endsWith("complete")) {await response.body?.cancel();throw new WorkerTaskClosedError();}
    if(response.status===404 && route.endsWith("complete-batch")) {await response.body?.cancel();throw new WorkerRouteNotFoundError();}
    if(!response.ok || response.headers.get("content-type")?.split(";",1)[0]!=="application/json") {await response.body?.cancel();throw new Error("Worker control plane unavailable");}
    const bytes=await boundedBody(response,maximumBytes);
    const value:unknown=JSON.parse(Buffer.from(bytes).toString("utf8"));
    if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).length!==2 || !Object.hasOwn(value,"data") || !Object.hasOwn(value,"meta")) throw new Error("Invalid worker envelope");
    return (value as {data:unknown}).data;
  }

  public async complete(ticket:string,result:Readonly<Record<string,unknown>>|undefined,parts:readonly {partNumber:number;etag:string}[]|undefined,errorCode?:string):Promise<void> {
    const body={ticket,...(result ? {result} : {}),...(parts ? {parts} : {}),...(errorCode ? {errorCode} : {})};
    for(let attempt=0;attempt<3;attempt++) {
      try {await this.post("work/complete",body,64*1024,120_000);return;}
      catch(error) {if(error instanceof WorkerTaskClosedError)return;if(error instanceof WorkerAuthenticationError || attempt===2) throw error;await delay(500*(attempt+1));}
    }
  }
}

export async function boundedBody(response:Response,maximum:number):Promise<Uint8Array> {
  if(!response.body) throw new Error("Empty worker response");
  const chunks:Uint8Array[]=[];let total=0;
  try {for await(const chunk of response.body){total+=chunk.byteLength;if(total>maximum) throw new Error("Worker response exceeds limit");chunks.push(chunk);}}
  finally {await response.body.cancel().catch(()=>undefined);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export function delay(milliseconds:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,milliseconds));}
