import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { gunzipSync } from "node:zlib";
import { BadRequestException,ConflictException,Inject,Injectable,Logger,NotFoundException,ServiceUnavailableException } from "@nestjs/common";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { RemoteWorkClaim,RemoteWorkReceipt,RemoteWorkTask,WorkerCapability } from "@seo-platform/contracts";
import { Prisma,type IntegrationCredential,type RemoteWorkTask as StoredTask } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationCredentialCryptoService,type IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import { OBJECT_STORAGE,type ObjectStoragePort,type CompletedPart } from "../storage/object-storage.port.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { signRemoteWorkTicket,verifyRemoteWorkTicket } from "./remote-work-ticket.js";
import { materializeRemoteProviderRequest,validateRemoteProviderRequest } from "./remote-provider-request.js";
import type { RemoteWorkScope } from "./remote-work-client.service.js";
import { remoteCredentialFingerprint } from "./remote-work-scope.js";

const MAX_ARTIFACT_BYTES = 8n * 1024n ** 3n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TASK_COLUMNS=Prisma.sql`id,workspace_id AS "workspaceId",project_id AS "projectId",operation_id AS "operationId",job_id AS "jobId",
  node_id AS "nodeId",capability,command,resource,source_scope AS "sourceScope",payload,payload_hash AS "payloadHash",request_fingerprint AS "requestFingerprint",state,
  read_token_hash AS "readTokenHash",lease_token AS "leaseToken",execution_deadline AS "executionDeadline",created_at AS "createdAt",
  claimed_at AS "claimedAt",finished_at AS "finishedAt",result,result_hash AS "resultHash",error_code AS "errorCode",
  result_object_key AS "resultObjectKey",result_multipart_id AS "resultMultipartId"`;

@Injectable()
export class RemoteWorkGatewayService {
  private readonly logger=new Logger(RemoteWorkGatewayService.name);
  private readonly notifications = new EventEmitter();
  private readonly completions=new Map<string,{hash:string;work:Promise<{readonly status:string}>}>();
  public constructor(private readonly prisma:PrismaService,private readonly nodes:WorkerNodeService,
    private readonly crypto:IntegrationCredentialCryptoService,@Inject(OBJECT_STORAGE) private readonly storage:ObjectStoragePort,
    @Inject(APP_CONFIG) private readonly config:AppConfig) {}

  public assertEnabled():void { if(!this.config.workerGatewayEnabled) throw new ServiceUnavailableException("Worker Gateway is disabled"); }
  public async cancelled(nodeId:string):Promise<readonly string[]> {
    const rows=await this.prisma.$queryRaw<{id:string}[]>`SELECT public.cancel_remote_work_for_node(${nodeId}::uuid) AS id`;
    for(const row of rows)this.notifications.emit("receipt",row.id);return rows.map(row=>row.id);
  }

  public async claim(nodeId:string,token:string,input:RemoteWorkClaim):Promise<readonly RemoteWorkTask[]> {
    this.assertEnabled();
    const node=await this.nodes.authorizeCombinedWork(nodeId,token);
    const capacities=Object.fromEntries(Object.entries(input.capabilitySlots).filter(([capability])=>node.capabilities.includes(capability as WorkerCapability)));
    const rows=await this.prisma.$queryRaw<StoredTask[]>`
      SELECT ${TASK_COLUMNS} FROM public.claim_remote_work(${nodeId}::uuid,${input.httpSlots}::integer,${input.cpuSlots}::integer,${JSON.stringify(capacities)}::jsonb)
    `;
    const result:RemoteWorkTask[]=[];
    const secrets=new Map<string,IntegrationCredentialSecret>();
    const credentialIds=[...new Set(rows.filter(task=>task.command==="PROVIDER_HTTP")
      .map(task=>(task.sourceScope as unknown as RemoteWorkScope).credentialId)
      .filter((id):id is string=>typeof id==="string" && UUID.test(id)))];
    let credentials:ReadonlyMap<string,IntegrationCredential>|undefined;
    if(credentialIds.length>0){
      try {
        const found=await this.prisma.integrationCredential.findMany({where:{id:{in:credentialIds},status:"ACTIVE",deletedAt:null}});
        credentials=new Map(found.map(row=>[row.id,row]));
      } catch {
        this.logger.warn("Worker credential batch read unavailable; using scoped per-item lookup");
      }
    }
    for(const task of rows) {
      try {
        const payload=await this.executionPayload(task,secrets,credentials);
        result.push({ schemaVersion:"worker-work-task@1",id:task.id,capability:task.capability as WorkerCapability,
          command:task.command as RemoteWorkTask["command"],resource:task.resource as "HTTP"|"CPU",payload,
          deadline:task.executionDeadline.toISOString(),ticket:signRemoteWorkTicket(this.config,{
            id:task.id,nodeId,leaseToken:task.leaseToken,payloadHash:task.payloadHash,
            expiresAt:new Date(task.executionDeadline.getTime()+120_000).toISOString()
          }) });
      } catch {
        await this.failTask(task,"WORKER_MATERIAL_UNAVAILABLE");
      }
    }
    return result;
  }

  public async receipts(value:unknown,waitMs:number):Promise<readonly RemoteWorkReceipt[]> {
    this.assertEnabled();
    if(!Array.isArray(value) || value.length<1 || value.length>256 || !Number.isSafeInteger(waitMs) || waitMs<0 || waitMs>5_000) invalid();
    const entries=value.map(entry=>{
      const row=record(entry); if(Object.keys(row).length!==2 || typeof row.id!=="string" || !UUID.test(row.id) || typeof row.token!=="string" || !UUID.test(row.token)) invalid();
      return { id:row.id,token:row.token };
    });
    let rows=await this.read(entries);
    if(waitMs>0 && rows.every(row=>row.state==="PENDING" || row.state==="CLAIMED")) {
      await this.wait(new Set(entries.map(entry=>entry.id)),waitMs);
      rows=await this.read(entries);
    }
    return Promise.all(rows.map(async task=>({ id:task.id,state:task.state as RemoteWorkReceipt["state"],
      ...(task.errorCode ? { errorCode:task.errorCode } : {}),
      ...(task.state==="COMPLETED" ? { result:{ ...record(task.result),...(task.resultObjectKey ? {
        artifactUrl:await this.storage.createDownloadUrl("artifacts",task.resultObjectKey),artifactObjectKey:task.resultObjectKey
      } : {}) } } : {})
    })));
  }

  private async read(entries:readonly { id:string;token:string }[]):Promise<StoredTask[]> {
    const rows=await this.prisma.$queryRaw<StoredTask[]>`SELECT ${TASK_COLUMNS} FROM public.read_remote_work_receipts(${JSON.stringify(entries)}::jsonb)`;
    const lost=rows.filter(task=>task.state==="PENDING" || task.state==="CLAIMED");
    if(lost.length) {
      const nodes=await this.prisma.executionWorkerNode.findMany({ where:{id:{in:[...new Set(lost.map(task=>task.nodeId))]}},select:{id:true,lastHeartbeatAt:true} });
      const healthy=new Set(nodes.filter(node=>node.lastHeartbeatAt && node.lastHeartbeatAt.getTime()>Date.now()-30_000).map(node=>node.id));
      for(const task of lost) {
        if(!this.completions.has(task.id) && (task.executionDeadline.getTime()<=Date.now() || !healthy.has(task.nodeId))) {
          const code=task.state==="PENDING" ? "WORKER_NOT_STARTED" : "WORKER_OUTCOME_UNKNOWN";
          await this.failTask(task,code); task.state="FAILED"; task.errorCode=code;
        }
      }
    }
    return rows;
  }

  public async initializeUpload(nodeId:string,token:string,ticketValue:unknown):Promise<{ readonly partSizeBytes:number }> {
    const task=await this.assigned(nodeId,token,ticketValue);
    if(task.state!=="CLAIMED") throw new ConflictException("Work unit is already closed");
    if(!task.resultMultipartId) {
      let objectKey=`remote-results/${task.workspaceId}/${task.operationId}/${task.id}/result`;
      if(task.command==="EXPORT_FILE") {
        if(!task.jobId) invalid();
        const job=await this.prisma.job.findFirst({where:{id:task.jobId,workspaceId:task.workspaceId,projectId:task.projectId,type:"SEMANTIC_EXPORT"},select:{attempt:true,inputSnapshot:true} });
        const format=job ? String(record(job.inputSnapshot).format) : "";
        const extension=({CSV:"csv",GOOGLE_CSV:"csv",TSV:"tsv",JSON:"json",NDJSON:"ndjson",XLSX:"xlsx"} as Record<string,string>)[format];
        if(!job || !extension || job.attempt<1 || !task.projectId) invalid();
        objectKey=`${task.workspaceId}/${task.projectId}/semantic-exports/${task.jobId}/attempt-${job.attempt}.${extension}`;
      }
      const upload=await this.storage.createMultipartUpload("artifacts",objectKey,"application/octet-stream");
      const changed=await this.prisma.remoteWorkTask.updateMany({ where:{id:task.id,state:"CLAIMED",resultMultipartId:null},data:{resultObjectKey:objectKey,resultMultipartId:upload.uploadId} });
      if(changed.count!==1) await this.storage.abortMultipartUpload("artifacts",objectKey,upload.uploadId);
    }
    return { partSizeBytes:8*1_048_576 };
  }

  public async partUrls(nodeId:string,token:string,ticketValue:unknown,values:unknown):Promise<readonly { partNumber:number;url:string }[]> {
    const task=await this.assigned(nodeId,token,ticketValue);
    if(task.state!=="CLAIMED" || !task.resultMultipartId || !task.resultObjectKey) throw new ConflictException("Artifact upload is unavailable");
    if(!Array.isArray(values) || values.length<1 || values.length>8 || new Set(values).size!==values.length || values.some(value=>!Number.isSafeInteger(value) || Number(value)<1 || Number(value)>10_000)) invalid();
    return Promise.all(values.map(async value=>({ partNumber:Number(value),url:await this.storage.createUploadPartUrl("artifacts",task.resultObjectKey!,task.resultMultipartId!,Number(value)) })));
  }

  public async complete(nodeId:string,token:string,ticketValue:unknown,resultValue:unknown,partsValue:unknown,errorValue:unknown):Promise<{ readonly status:string }> {
    const task=await this.assigned(nodeId,token,ticketValue);
    const result=resultValue===undefined ? undefined : record(resultValue);
    if(result && Buffer.byteLength(JSON.stringify(result))>512*1024) invalid();
    if(errorValue!==undefined && (typeof errorValue!=="string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(errorValue))) invalid();
    if((result===undefined)===(errorValue===undefined)) invalid();
    const parts=parseParts(partsValue);
    const hash=canonicalJsonSha256("remote-work-result@1",{result:result??null,parts,errorCode:errorValue??null});
    if(task.state==="COMPLETED") { if(task.resultHash!==hash) throw new ConflictException("Receipt differs from the committed result"); return {status:"COMPLETED"}; }
    if(task.state==="FAILED" && task.errorCode===errorValue) return {status:"FAILED"};
    if(task.state!=="CLAIMED") throw new ConflictException("Work unit is no longer assigned");
    const pending=this.completions.get(task.id);
    if(pending){if(pending.hash!==hash)throw new ConflictException("Result acknowledgement differs");return pending.work;}
    const work=this.commitResult(task,nodeId,token,result,parts,errorValue,hash);
    this.completions.set(task.id,{hash,work});
    try{return await work;}finally{if(this.completions.get(task.id)?.work===work)this.completions.delete(task.id);}
  }

  private async commitResult(task:StoredTask,nodeId:string,token:string,result:Record<string,unknown>|undefined,parts:readonly CompletedPart[],errorValue:unknown,hash:string):Promise<{readonly status:string}> {
    if(errorValue!==undefined) { await this.failTask(task,errorValue as string); return {status:"FAILED"}; }
    if(!result) invalid();
    if(JSON.stringify(result).includes(token)) invalid();
    if(task.command==="PROVIDER_HTTP") {
      const fields=["format","status","headers",...(parts.length ? ["artifact"] : ["bodyBase64","bodyEncoding"])];
      if(Object.keys(result).length!==fields.length || fields.some(key=>!Object.hasOwn(result,key)) || result.format!=="HTTP" || !Number.isSafeInteger(result.status) || Number(result.status)<200 || Number(result.status)>599) invalid();
      const headers=record(result.headers);if(Object.entries(headers).some(([name,value])=>!["content-type","retry-after"].includes(name) || typeof value!=="string" || value.length>1024)) invalid();
    }
    if(parts.length) {
      if(!task.resultObjectKey || !task.resultMultipartId) invalid();
      await this.storage.completeMultipartUpload("artifacts",task.resultObjectKey,task.resultMultipartId,parts);
      const artifact=record(result.artifact);
      const size=parseSize(artifact.sizeBytes),sha=artifact.sha256;
      if(typeof sha!=="string" || !/^[a-f0-9]{64}$/u.test(sha)) invalid();
      const maximum=task.command==="PROVIDER_HTTP" ? BigInt(Number(record(task.payload).maxBytes)) : MAX_ARTIFACT_BYTES;
      if(size>maximum) invalid();
      const metadata=await this.storage.headObject("artifacts",task.resultObjectKey);
      if(!metadata || metadata.sizeBytes!==size) throw new ConflictException("Artifact size differs");
      const secret=task.command==="PROVIDER_HTTP" ? await this.credential(task,true) : undefined;
      await this.verifyArtifact(task.resultObjectKey,size,sha,secret?.apiKey);
    } else if(task.command==="PROVIDER_HTTP") {
      const secret=await this.credential(task,true);
      if(typeof result.bodyBase64!=="string" || result.bodyBase64.length>64*1024 || result.bodyEncoding!=="GZIP") invalid();
      const body=gunzipSync(Buffer.from(result.bodyBase64,"base64"),{maxOutputLength:Math.min(256*1024,Number(record(task.payload).maxBytes))});
      if(body.toString("utf8").includes(secret.apiKey) || JSON.stringify(result.headers).includes(secret.apiKey)) invalid();
    }
    const changed=await this.prisma.remoteWorkTask.updateMany({where:{id:task.id,nodeId,leaseToken:task.leaseToken,state:"CLAIMED"},data:{state:"COMPLETED",result:result as Prisma.InputJsonValue,resultHash:hash,finishedAt:new Date()} });
    if(changed.count!==1) throw new ConflictException("Work unit completion conflicted");
    this.notifications.emit("receipt",task.id);
    return {status:"COMPLETED"};
  }

  private async executionPayload(task:StoredTask,secrets:Map<string,IntegrationCredentialSecret>,credentials?:ReadonlyMap<string,IntegrationCredential>):Promise<Readonly<Record<string,unknown>>> {
    const payload=record(task.payload),scope=task.sourceScope as unknown as RemoteWorkScope;
    if(task.command==="PROVIDER_HTTP") {
      const request=validateRemoteProviderRequest(payload,task.capability as WorkerCapability);
      const cacheKey=JSON.stringify([task.workspaceId,scope.provider,scope.credentialId,scope.physicalKeyScopeId,scope.credentialFingerprint]);
      let secret=secrets.get(cacheKey);
      if(!secret){secret=credentials ? this.credentialFromRow(task,credentials.get(scope.credentialId ?? ""),false) : await this.credential(task,false);secrets.set(cacheKey,secret);}
      return materializeRemoteProviderRequest(request,secret);
    }
    if(task.command==="IMPORT_ROWS" || task.command==="UPLOAD_INSPECTION") {
      const importRow=task.command==="IMPORT_ROWS" ? await this.prisma.semanticImport.findUnique({where:{id:task.operationId},select:{uploadId:true}}) : null;
      const upload=await this.prisma.upload.findFirst({where:{id:importRow?.uploadId ?? task.operationId,workspaceId:task.workspaceId,projectId:task.projectId},select:{objectKey:true,sizeBytes:true,mediaType:true,declaredChecksum:true} });
      if(!upload) throw new NotFoundException("Source file is unavailable");
      return {...payload,sourceUrl:await this.storage.createDownloadUrl("uploads",upload.objectKey),sourceSizeBytes:upload.sizeBytes.toString(),sourceMediaType:upload.mediaType,declaredChecksum:upload.declaredChecksum};
    }
    if(task.command==="EXPORT_FILE") {
      if(typeof payload.inputObjectKey!=="string" || !payload.inputObjectKey.startsWith(`remote-inputs/${scope.workspaceId}/${scope.operationId}/`)) invalid();
      return {...payload,inputUrl:await this.storage.createDownloadUrl("artifacts",payload.inputObjectKey)};
    }
    return payload;
  }

  private async credential(task:StoredTask,allowInactive:boolean):Promise<IntegrationCredentialSecret> {
    const scope=task.sourceScope as unknown as RemoteWorkScope;
    if(!scope.credentialId || !UUID.test(scope.credentialId) || !scope.physicalKeyScopeId || !UUID.test(scope.physicalKeyScopeId) || !scope.provider) invalid();
    const row=await this.prisma.integrationCredential.findFirst({where:{id:scope.credentialId,workspaceId:task.workspaceId,...(!allowInactive ? {status:"ACTIVE",deletedAt:null} : {})} });
    return this.credentialFromRow(task,row,allowInactive);
  }

  private credentialFromRow(task:StoredTask,row:IntegrationCredential|undefined|null,allowInactive:boolean):IntegrationCredentialSecret {
    const scope=task.sourceScope as unknown as RemoteWorkScope;
    if(!scope.credentialId || !UUID.test(scope.credentialId) || !scope.physicalKeyScopeId || !UUID.test(scope.physicalKeyScopeId) || !scope.provider) invalid();
    if(!row || row.id!==scope.credentialId || row.workspaceId!==task.workspaceId || row.provider!==scope.provider ||
      (!allowInactive && (row.status!=="ACTIVE" || row.deletedAt!==null))) throw new NotFoundException("Assigned credential is unavailable");
    const encrypted={keyVersion:row.keyVersion,ciphertext:Buffer.from(row.ciphertext),nonce:Buffer.from(row.nonce),authTag:Buffer.from(row.authTag),encryptedDataKey:Buffer.from(row.encryptedDataKey),dataKeyNonce:Buffer.from(row.dataKeyNonce),dataKeyAuthTag:Buffer.from(row.dataKeyAuthTag)};
    if(scope.credentialFingerprint && scope.credentialFingerprint!==remoteCredentialFingerprint(encrypted)) throw new ConflictException("Credential material changed");
    const decrypted=this.crypto.decrypt(task.workspaceId,scope.provider!,row.id,encrypted);
    if(decrypted.platformPool) {
      const selected=decrypted.platformPool.find(entry=>entry.id===scope.physicalKeyScopeId);
      if(!selected) throw new NotFoundException("Assigned physical key is unavailable");
      return selected;
    }
    if(decrypted.rateLimitScopeId && decrypted.rateLimitScopeId!==scope.physicalKeyScopeId) throw new ConflictException("Credential material changed");
    return decrypted;
  }

  private async assigned(nodeId:string,token:string,value:unknown):Promise<StoredTask> {
    this.assertEnabled(); await this.nodes.authenticateForCompletion(nodeId,token);
    const ticket=verifyRemoteWorkTicket(this.config,value,nodeId);
    const task=await this.prisma.remoteWorkTask.findFirst({where:{id:ticket.id,nodeId,leaseToken:ticket.leaseToken,payloadHash:ticket.payloadHash} });
    if(!task) throw new NotFoundException("Assigned work unit is unavailable");
    return task;
  }

  private async failTask(task:StoredTask,code:string):Promise<void> {
    await this.prisma.remoteWorkTask.updateMany({where:{id:task.id,state:{in:["PENDING","CLAIMED"]}},data:{state:"FAILED",errorCode:code,finishedAt:new Date()} });
    this.notifications.emit("receipt",task.id);
  }

  private wait(ids:ReadonlySet<string>,milliseconds:number):Promise<void> {
    return new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);this.notifications.off("receipt",changed);resolve();};
      const changed=(id:string)=>{if(ids.has(id)) finish();};
      const timer=setTimeout(finish,milliseconds); this.notifications.on("receipt",changed);
    });
  }

  private async verifyArtifact(key:string,size:bigint,expectedHash:string,secret?:string):Promise<void> {
    const hash=createHash("sha256"); let bytes=0n; let overlap="";
    for await(const chunk of await this.storage.getObjectStream("artifacts",key)) {
      bytes+=BigInt(chunk.byteLength); if(bytes>size) invalid(); hash.update(chunk);
      if(secret) { const text=overlap+Buffer.from(chunk).toString("utf8"); if(text.includes(secret)) invalid(); overlap=text.slice(-secret.length); }
    }
    if(bytes!==size || hash.digest("hex")!==expectedHash) throw new ConflictException("Artifact checksum differs");
  }
}

function record(value:unknown):Record<string,unknown> {if(!value || typeof value!=="object" || Array.isArray(value)) invalid(); return value as Record<string,unknown>;}
function parseSize(value:unknown):bigint {if(typeof value!=="string" || !/^(?:0|[1-9][0-9]{0,12})$/u.test(value)) invalid();return BigInt(value);}
function parseParts(value:unknown):CompletedPart[] { if(value===undefined) return []; if(!Array.isArray(value) || value.length>10_000) invalid(); return value.map((part,index)=>{const row=record(part); if(row.partNumber!==index+1 || typeof row.etag!=="string" || row.etag.length>256 || !/^[A-Za-z0-9"-]+$/u.test(row.etag)) invalid();return {partNumber:index+1,etag:row.etag};}); }
function invalid():never {throw new BadRequestException("Invalid remote work material");}
