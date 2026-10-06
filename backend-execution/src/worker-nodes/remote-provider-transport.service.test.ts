import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { RemoteProviderTransportService } from "./remote-provider-transport.service.js";

test("confirmed unbilled Wordstat responses are excluded before the owner retries", async () => {
  const workspaceId=randomUUID(),projectId=randomUUID(),operationId=randomUUID();
  const receipt={id:randomUUID(),readToken:randomUUID()};
  const excluded:string[]=[];
  let providerResponse:{status:number;body:unknown}={status:200,body:{error:{code:55}}};
  const work={
    enabled:()=>true,
    execute:async (...args:unknown[]) => {
      const decode=args[5] as (result:Readonly<Record<string,unknown>>,identity:typeof receipt)=>Promise<Response>;
      return decode({format:"HTTP",status:providerResponse.status,headers:{"content-type":"application/json"},
        bodyEncoding:"GZIP",bodyBase64:gzipSync(Buffer.from(JSON.stringify(providerResponse.body))).toString("base64")},receipt);
    },
    excludeUnbilledProviderReceipt:async (identity:typeof receipt,reason:string)=>{
      assert.deepEqual(identity,receipt);
      excluded.push(reason);
    }
  };
  const transport=new RemoteProviderTransportService(work as never,{} as never);
  const secret={apiKey:"fixture-secret-123456",accountIdentifier:"123456",rateLimitScopeId:randomUUID()};
  const scope={origin:"JOB" as const,workspaceId,projectId,operationId,jobId:operationId,
    credentialId:randomUUID(),provider:"XMLSTOCK" as const,leaseOwner:`fixture-${randomUUID()}`};
  const url=new URL("https://xmlstock.com/wordstat/json/");
  url.searchParams.set("user",secret.accountIdentifier);
  url.searchParams.set("key",secret.apiKey);
  url.searchParams.set("query","fixture");
  const fetchResponse=()=>transport.run(scope,"WORDSTAT",async()=>{
    transport.useSecret(secret);
    return transport.fetcher(url,{method:"GET",headers:{Accept:"application/json"}});
  });

  assert.deepEqual(await (await fetchResponse()).json(),{error:{code:55}});
  assert.deepEqual(excluded,["PROVIDER_RATE_LIMITED"]);
  providerResponse={status:503,body:{}};
  assert.deepEqual(await (await fetchResponse()).json(),{});
  assert.deepEqual(excluded,["PROVIDER_RATE_LIMITED","PROVIDER_RATE_LIMITED"]);
  providerResponse={status:200,body:{totalCount:37}};
  assert.deepEqual(await (await fetchResponse()).json(),{totalCount:37});
  assert.equal(excluded.length,2,"successful paid receipts remain replayable");
});
