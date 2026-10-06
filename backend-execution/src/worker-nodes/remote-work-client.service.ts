import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import { parseRemoteWorkReceipt, type RemoteWorkCommand, type RemoteWorkReceipt, type RemoteWorkResource, type WorkerCapability } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { boundedBody } from "./worker-http-client.js";

export interface RemoteWorkScope {
  readonly origin: "JOB" | "RANK" | "RESEARCH" | "IMPORT" | "UPLOAD";
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly operationId: string;
  readonly jobId?: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly executionId?: string;
  readonly claimedAt?: string;
  readonly credentialId?: string;
  readonly credentialFingerprint?:string;
  readonly physicalKeyScopeId?: string;
  readonly provider?: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO";
}

interface Pending {
  readonly token: string;
  readonly resolve: (receipt: RemoteWorkReceipt) => void;
  readonly reject: (error: Error) => void;
}
interface Admission {readonly scope:RemoteWorkScope;readonly capability:WorkerCapability;readonly command:RemoteWorkCommand;readonly resource:RemoteWorkResource;readonly payload:Readonly<Record<string,unknown>>;readonly hash:string;readonly timeoutMs:number;}
interface Assignment {readonly id:string|null;readonly readToken:string|null;readonly nodeId:string|null;readonly blocked:boolean;readonly errorCode:string|null;}
interface ReceiptIdentity { readonly id: string; readonly readToken: string; }

export class RemoteWorkFailedError extends Error {
  public constructor(public readonly code: string) { super("Remote work did not complete"); this.name = "RemoteWorkFailedError"; }
}

/** Each runtime process waits on one batched long poll, independently of its lane count. */
@Injectable()
export class RemoteWorkClientService implements OnModuleDestroy {
  private readonly pending = new Map<string, Pending>();
  private polling = false;
  private stopped = false;
  private readonly shutdown = new AbortController();
  private readonly availability = new Map<WorkerCapability,{until:number;value:boolean}>();
  private readonly admissions:{entry:Admission;resolve:(assignment:Assignment)=>void;reject:(error:unknown)=>void}[]=[];
  private admissionTimer:ReturnType<typeof setTimeout>|undefined;
  private pollStartTimer:ReturnType<typeof setTimeout>|undefined;
  private admitting=false;

  public constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public enabled(): boolean { return this.config.remoteWorkEnabled; }
  public async available(capability:WorkerCapability):Promise<boolean> {
    if(!this.enabled()) return false;
    const cached=this.availability.get(capability); if(cached && cached.until>Date.now()) return cached.value;
    const rows=await this.prisma.$queryRaw<{available:boolean}[]>`SELECT public.remote_work_available(${capability}::text) AS available`;
    const value=rows[0]?.available===true; this.availability.set(capability,{value,until:Date.now()+5_000}); return value;
  }

  public async execute<T>(scope: RemoteWorkScope, capability: WorkerCapability, command: RemoteWorkCommand,
    payload: Readonly<Record<string, unknown>>, options: Readonly<{ resource: RemoteWorkResource; timeoutMs: number; onWait?: () => Promise<void> }>,
    decode: (result: Readonly<Record<string, unknown>>, receipt: ReceiptIdentity) => Promise<T> | T,
    local: () => Promise<T>): Promise<T> {
    if(!this.enabled()) return local();
    if(command!=="PROVIDER_HTTP" && !await this.available(capability)) return local();
    const hash = canonicalJsonSha256("remote-work-payload@1", { command, capability, payload });
    const assignment=await this.admit({scope,capability,command,resource:options.resource,payload,hash,timeoutMs:options.timeoutMs});
    if(assignment.errorCode) throw new RemoteWorkFailedError(assignment.errorCode);
    if(assignment.blocked) throw new RemoteWorkFailedError("WORKER_RETRY_LIMIT");
    if(!assignment.id) return local();
    const id=assignment.id,readToken=assignment.readToken;
    if(!readToken) throw new RemoteWorkFailedError("INVALID_WORKER_ASSIGNMENT");
    let heartbeatRunning = false;
    let heartbeatFailure: Error | undefined;
    const heartbeat = options.onWait ? setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void options.onWait!().catch(() => { heartbeatFailure = new RemoteWorkFailedError("SOURCE_LEASE_LOST"); this.pending.get(id)?.reject(heartbeatFailure); })
        .finally(() => { heartbeatRunning = false; });
    },10_000) : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const receipt = await new Promise<RemoteWorkReceipt>((resolve,reject) => {
        this.pending.set(id,{ token: readToken,resolve,reject });
        timer = setTimeout(() => reject(new RemoteWorkFailedError("WORKER_RESULT_TIMEOUT")),options.timeoutMs+5_000);
        this.schedulePoll();
      });
      if (heartbeatFailure) throw heartbeatFailure;
      if (receipt.state !== "COMPLETED" || !receipt.result) throw new RemoteWorkFailedError(receipt.errorCode ?? "WORKER_EXECUTION_FAILED");
      return await decode(receipt.result,{id,readToken});
    } catch (error) {
      // Only an unclaimed unit can be abandoned. A claimed provider request
      // is never repeated here; its owning workflow applies the retry policy.
      const rows=await this.prisma.$queryRaw<{state:string}[]>`SELECT public.abandon_remote_work(${id}::uuid,${readToken}::uuid) AS state`;
      if(command!=="PROVIDER_HTTP" && ["FAILED","ABANDONED"].includes(rows[0]?.state ?? "") && error instanceof RemoteWorkFailedError &&
        (["WORKER_NOT_STARTED","WORKER_OUTCOME_UNKNOWN","WORKER_PROCESS_EXITED","WORKER_EXECUTION_FAILED","WORKER_RESULT_TIMEOUT","MALWARE_SCANNER_UNAVAILABLE","SOURCE_DOWNLOAD_FAILED","ARTIFACT_UPLOAD_FAILED","WORKER_MATERIAL_UNAVAILABLE"].includes(error.code) ||
          (command==="IMPORT_ROWS" && error.code==="INVALID_XLSX"))) {
        // Non-paid work may safely continue locally, but only after the remote
        // receipt is fenced closed. An active CPU upload must not race a local
        // export to the same canonical object key. A remote-only XLSX parser
        // rejection is checked again by the owning parser before failing.
        return await local();
      }
      if(rows[0]?.state==="ABANDONED") throw new RemoteWorkFailedError("WORKER_NOT_STARTED");
      throw error;
    } finally {
      this.pending.delete(id);
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  public async excludeUnbilledProviderReceipt(
    receipt: ReceiptIdentity,
    reason: "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE"
  ): Promise<void> {
    const rows=await this.prisma.$queryRaw<{excluded:boolean}[]>`
      SELECT public.exclude_remote_work_retryable_receipt(
        ${receipt.id}::uuid,${receipt.readToken}::uuid,${reason}::text
      ) AS excluded
    `;
    if(rows[0]?.excluded!==true)throw new RemoteWorkFailedError("INVALID_WORKER_ASSIGNMENT");
  }

  private admit(entry:Admission):Promise<Assignment> {
    return new Promise((resolve,reject)=>{this.admissions.push({entry,resolve,reject});if(!this.admissionTimer)this.admissionTimer=setTimeout(()=>{this.admissionTimer=undefined;void this.flushAdmissions();},5);});
  }
  private async flushAdmissions():Promise<void> {
    if(this.admitting || this.stopped)return;this.admitting=true;
    const batch:typeof this.admissions=[];let bytes=0;
    while(this.admissions.length && batch.length<64){const next=this.admissions[0]!,size=Buffer.byteLength(JSON.stringify(next.entry));if(batch.length && bytes+size>4*1_048_576)break;batch.push(this.admissions.shift()!);bytes+=size;}
    try {
      const rows=await this.prisma.$queryRaw<readonly (Assignment & {ordinal:number})[]>`SELECT * FROM public.enqueue_remote_work_batch(${JSON.stringify(batch.map(row=>row.entry))}::jsonb)`;
      if(rows.length!==batch.length || new Set(rows.map(row=>row.ordinal)).size!==rows.length || rows.some(row=>!Number.isSafeInteger(row.ordinal) || row.ordinal<1 || row.ordinal>batch.length)) throw new RemoteWorkFailedError("INVALID_WORKER_ASSIGNMENT");
      for(const row of rows)batch[row.ordinal-1]!.resolve(row);
    } catch(error){for(const row of batch)row.reject(error);}
    finally{this.admitting=false;if(this.admissions.length && !this.stopped)void this.flushAdmissions();}
  }

  private schedulePoll():void {
    if(this.polling || this.pollStartTimer || this.stopped)return;
    // All callers in one SQL admission can join the same receipt request.
    this.pollStartTimer=setTimeout(()=>{this.pollStartTimer=undefined;void this.poll();},0);
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      while (this.pending.size > 0 && !this.stopped) {
        const entries = [...this.pending.entries()].slice(0,256).map(([id,value]) => ({ id,token: value.token }));
        try {
          const response = await fetch(new URL("/internal/v1/remote-work/receipts",this.config.remoteWorkControlUrl), {
            method: "POST",headers: { "Content-Type":"application/json",Accept:"application/json" },
            body: JSON.stringify({ entries,waitMs:5_000 }),redirect:"error",
            signal:AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(8_000)])
          });
          if (!response.ok) { await response.body?.cancel(); throw new Error("Receipt channel unavailable"); }
          const body: unknown = JSON.parse(Buffer.from(await boundedBody(response,16*1_048_576)).toString("utf8"));
          const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
          if (!Array.isArray(data) || data.length > entries.length) throw new Error("Invalid receipt batch");
          for (const value of data) {
            const receipt = parseRemoteWorkReceipt(value);
            const pending = this.pending.get(receipt.id);
            if (pending && ["COMPLETED","FAILED","ABANDONED"].includes(receipt.state)) {
              this.pending.delete(receipt.id); pending.resolve(receipt);
            }
          }
        } catch {
          if (this.stopped) break;
          await new Promise<void>((resolve) => { const retry=setTimeout(resolve,1_000); retry.unref(); });
        }
      }
    } finally {
      this.polling=false;
      if (this.pending.size>0 && !this.stopped) void this.poll();
    }
  }

  public onModuleDestroy(): void {
    this.stopped=true; this.shutdown.abort();
    for (const waiter of this.pending.values()) waiter.reject(new RemoteWorkFailedError("RUNTIME_STOPPED"));
    this.pending.clear();
    if(this.admissionTimer)clearTimeout(this.admissionTimer);
    if(this.pollStartTimer)clearTimeout(this.pollStartTimer);
    for(const row of this.admissions.splice(0))row.reject(new RemoteWorkFailedError("RUNTIME_STOPPED"));
  }
}
