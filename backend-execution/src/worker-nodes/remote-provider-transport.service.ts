import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { ProviderExecutionReviewRequiredError,ProviderCapacityUnavailableError } from "../integrations/provider-execution-review.js";
import { XmlStockHttpQuotaLimiter } from "../integrations/xmlstock-http-quota-limiter.js";
import { Injectable } from "@nestjs/common";
import type { WorkerCapability } from "@seo-platform/contracts";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { ProviderRequestInit } from "../integrations/provider-json-request.js";
import { RemoteWorkClientService,RemoteWorkFailedError,type RemoteWorkScope } from "./remote-work-client.service.js";
import { remoteProviderRequest,REMOTE_PROVIDER_ADMISSION_MS } from "./remote-provider-request.js";
import { remoteArtifact } from "./remote-artifact.js";

interface Context { readonly scope:RemoteWorkScope;readonly capability:WorkerCapability;secret?:IntegrationCredentialSecret; }

@Injectable()
export class RemoteProviderTransportService {
  private readonly context=new AsyncLocalStorage<Context>();
  public constructor(private readonly work:RemoteWorkClientService,private readonly quota:XmlStockHttpQuotaLimiter) {}

  public run<T>(scope:RemoteWorkScope,capability:WorkerCapability,action:()=>Promise<T>):Promise<T> {return this.context.run({scope,capability},action);}
  public useSecret(secret:IntegrationCredentialSecret):void {const context=this.context.getStore();if(context) context.secret=secret;}

  public readonly fetcher:ProviderFetch=async (url,init)=>{
    const context=this.context.getStore();
    if(!context?.secret || !this.work.enabled()) return fetch(url,init);
    const budget=(init as ProviderRequestInit | undefined)?.providerBudget ?? { timeoutMs:10_000,maximumResponseBytes:1_048_576 };
    // Large provider batches remain supported by the owning local runtime;
    // they must not turn into an invalid transport envelope or a paid retry.
    if (typeof init?.body === "string" && Buffer.byteLength(init.body) > 896 * 1024) {
      return this.localFetch(url, init, context, budget.timeoutMs);
    }
    const request=remoteProviderRequest(url,init,context.secret,context.capability,budget.timeoutMs,budget.maximumResponseBytes);
    const physicalKeyScopeId=context.secret.rateLimitScopeId ?? context.scope.credentialId;
    if(!physicalKeyScopeId) throw new RemoteWorkFailedError("INVALID_CREDENTIAL_REFERENCE");
    const scope={...context.scope,physicalKeyScopeId};
    try {
      return await this.work.execute(scope,context.capability,"PROVIDER_HTTP",request as unknown as Readonly<Record<string,unknown>>,
        // The owner must remain alive long enough for admission, the provider
        // timeout and result acknowledgement; otherwise a paid response could
        // be misclassified as unknown while the remote worker is still active.
        {resource:"HTTP",timeoutMs:Math.min(180_000,budget.timeoutMs+REMOTE_PROVIDER_ADMISSION_MS+15_000)},async result=>{
          if(result.format!=="HTTP" || !Number.isSafeInteger(result.status) || Number(result.status)<100 || Number(result.status)>599 || !result.headers || typeof result.headers!=="object" || Array.isArray(result.headers)) throw new RemoteWorkFailedError("INVALID_WORKER_HTTP_RESPONSE");
          const headers=new Headers();
          for(const [name,value] of Object.entries(result.headers)) {
            if(!["content-type","retry-after"].includes(name) || typeof value!=="string" || value.length>1024) throw new RemoteWorkFailedError("INVALID_WORKER_HTTP_RESPONSE");headers.set(name,value);
          }
          const status=Number(result.status);
          let body:ConstructorParameters<typeof Response>[0];
          if([204,205,304].includes(status)) body=null;
          else if(typeof result.bodyBase64==="string") {let bytes=Buffer.from(result.bodyBase64,"base64");if(result.bodyEncoding==="GZIP") bytes=gunzipSync(bytes,{maxOutputLength:budget.maximumResponseBytes});else if(result.bodyEncoding!==undefined) throw new RemoteWorkFailedError("INVALID_WORKER_HTTP_RESPONSE");if(bytes.length>budget.maximumResponseBytes) throw new RemoteWorkFailedError("WORKER_RESPONSE_TOO_LARGE");body=bytes;}
          else body=Readable.toWeb(Readable.from(remoteArtifact(result,BigInt(budget.maximumResponseBytes)))) as ReadableStream;
          return new Response(body,{status,headers});
        },()=>this.localFetch(url,init,context,budget.timeoutMs));
    } catch(error) {
      // Arsenkin check/get only read an already accepted task. A lost worker
      // acknowledgement on these calls can be retried safely; only tools/set
      // is an ambiguous paid submit.
      const target=new URL(url instanceof Request ? url.url : String(url));
      if(target.hostname==="arsenkin.ru" && ["/api/tools/check","/api/tools/get"].includes(target.pathname) &&
        error instanceof RemoteWorkFailedError && ["WORKER_OUTCOME_UNKNOWN","WORKER_RESULT_TIMEOUT"].includes(error.code)) {
        return this.localFetch(url,init,context,budget.timeoutMs);
      }
      if(error instanceof RemoteWorkFailedError && error.code==="WORKER_RETRY_LIMIT" && context.capability!=="RANK") throw new ProviderExecutionReviewRequiredError();
      if(error instanceof RemoteWorkFailedError && ["WORKER_NOT_STARTED","WORKER_MATERIAL_UNAVAILABLE","SOURCE_SCOPE_REVOKED"].includes(error.code)) {
        throw new ProviderCapacityUnavailableError();
      }
      throw error;
    }
  };

  private async localFetch(url:Parameters<ProviderFetch>[0],init:RequestInit|undefined,context:Context,timeoutMs:number):Promise<Response> {
    if(context.scope.provider!=="XMLSTOCK") return fetch(url,init);
    const physical=context.secret?.rateLimitScopeId ?? context.scope.credentialId;
    if(!physical) throw new ProviderCapacityUnavailableError();
    const permit=await this.quota.acquireLocalNodeSlot(physical,Math.min(120_000,timeoutMs+3_000));
    if(!permit.allowed) throw new ProviderCapacityUnavailableError();
    let released=false;
    const release=async()=>{if(released)return;released=true;await this.quota.releaseLocalNodeSlot(permit);};
    try {
      const response=await fetch(url,init);
      if(!response.body){await release();return response;}
      const reader=response.body.getReader();
      const body=new ReadableStream<Uint8Array>({
        async pull(controller){try{const next=await reader.read();if(next.done){await release();controller.close();}else controller.enqueue(next.value);}catch(error){await release();controller.error(error);}},
        async cancel(reason){try{await reader.cancel(reason);}finally{await release();}}
      });
      return new Response(body,{status:response.status,headers:response.headers});
    } catch(error){await release();throw error;}
  }
}
