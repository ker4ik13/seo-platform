import { BadRequestException,Body,Controller,Header,Headers,Logger,Post,Req } from "@nestjs/common";
import { parseRemoteWorkClaim,type ApiResponse,type RemoteRankPollTaskV1,type RemoteWorkTask } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { RemoteWorkGatewayService } from "./remote-work-gateway.service.js";
import { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { workerIdentity,exactWorkerInput } from "./worker-wire-input.js";

type RequestHeaders=Readonly<Record<string,string|string[]|undefined>>;
// Leave enough time for several bounded rank DB waves while keeping other
// capabilities behind a strict short ceiling on the same combined poll.
const RANK_CLAIM_PASS_BUDGET_MS=2_500;

@Controller("worker/v1")
export class RemoteWorkController {
  private readonly logger=new Logger(RemoteWorkController.name);
  public constructor(private readonly work:RemoteWorkGatewayService,private readonly ranks:WorkerRankGatewayService,private readonly nodes:WorkerNodeService) {}

  @Post("claim")
  @Header("Cache-Control","no-store")
  public async claim(@Body() value:unknown,@Headers() headers:RequestHeaders,@Req() request:FastifyRequest):Promise<ApiResponse<{work:readonly RemoteWorkTask[];ranks:readonly RemoteRankPollTaskV1[];cancelled:readonly string[]}>> {
    let input; try { input=parseRemoteWorkClaim(value); } catch { throw new BadRequestException("Invalid worker capacity"); }
    const {id,token}=workerIdentity(headers);
    const node=await this.nodes.authorizeCombinedWork(id,token);
    const rankSlots=node.capabilities.includes("RANK") ? Math.min(input.capabilitySlots.RANK ?? 0,input.httpSlots) : 0;
    const reservedRank=Math.min(rankSlots,node.capabilities.every(capability=>capability==="RANK")
      ? input.httpSlots : Math.ceil(input.httpSlots/2));
    const initialWorkSlots=input.httpSlots-reservedRank;
    // The two independently fenced admission paths run in parallel. A slow
    // rank page must not hold queued Wordstat/Arsenkin/crawl behind it.
    const [rankPass,workPass]=await Promise.allSettled([
      reservedRank>0 ? this.ranks.claimBatch(id,token,reservedRank,RANK_CLAIM_PASS_BUDGET_MS) : Promise.resolve([]),
      this.work.claim(id,token,{...input,httpSlots:initialWorkSlots,
        capabilitySlots:{...input.capabilitySlots,RANK:Math.max(0,rankSlots-reservedRank)}})
    ]);
    if(rankPass.status==="rejected" && workPass.status==="rejected")throw rankPass.reason;
    if(rankPass.status==="rejected")this.logger.warn(JSON.stringify({event:"remote_rank_batch_admission_failed",...admissionErrorCodes(rankPass.reason)}));
    if(workPass.status==="rejected")this.logger.warn(JSON.stringify({event:"remote_work_admission_failed",...admissionErrorCodes(workPass.reason)}));
    const ranks=rankPass.status==="fulfilled" ? rankPass.value : [];
    const initialWork=workPass.status==="fulfilled" ? workPass.value : [];
    const initialWorkHttp=initialWork.filter(task=>task.resource==="HTTP").length;
    const spareHttp=Math.max(0,input.httpSlots-ranks.length-initialWorkHttp);
    // When the non-rank half is idle, return it to a busy rank-only backlog.
    // A second bounded claim is needed only if the first rank pass filled its
    // reservation; the database lease prevents duplicate assignment.
    const topUpRanks=spareHttp>0 && reservedRank>0 && ranks.length===reservedRank && rankSlots>ranks.length &&
      initialWorkHttp<initialWorkSlots && rankPass.status==="fulfilled" && workPass.status==="fulfilled"
      ? await this.ranks.claimBatch(id,token,Math.min(spareHttp,rankSlots-ranks.length),RANK_CLAIM_PASS_BUDGET_MS)
        .catch((error:unknown)=>{this.logger.warn(JSON.stringify({event:"remote_rank_topup_failed",...admissionErrorCodes(error)}));return [];})
      : [];
    // If the first work half filled, reuse rank capacity that was not needed.
    // Idle workers do not issue a second empty database claim.
    const topUp=spareHttp>0 && topUpRanks.length===0 && initialWorkHttp===initialWorkSlots && workPass.status==="fulfilled" &&
      (initialWorkSlots>0 || (reservedRank>0 && ranks.length===0))
      ? await this.work.claim(id,token,{...input,httpSlots:spareHttp,cpuSlots:0,
        capabilitySlots:Object.fromEntries(Object.entries(input.capabilitySlots).map(([capability,slots])=>[
          capability,Math.max(0,slots-initialWork.filter(task=>task.capability===capability).length-(capability==="RANK" ? ranks.length : 0))
        ]))}).catch((error:unknown)=>{this.logger.warn(JSON.stringify({event:"remote_work_topup_failed",...admissionErrorCodes(error)}));return [];})
      : [];
    const work=[...initialWork,...topUp];
    return {data:{work,ranks:[...ranks,...topUpRanks],cancelled:await this.work.cancelled(id)},meta:{requestId:request.id}};
  }

  @Post("work/upload/init")
  @Header("Cache-Control","no-store")
  public async initialize(@Body() value:unknown,@Headers() headers:RequestHeaders,@Req() request:FastifyRequest) {
    const input=exactWorkerInput(value,["ticket"]),{id,token}=workerIdentity(headers);
    return {data:await this.work.initializeUpload(id,token,input.ticket),meta:{requestId:request.id}};
  }

  @Post("work/upload/parts")
  @Header("Cache-Control","no-store")
  public async parts(@Body() value:unknown,@Headers() headers:RequestHeaders,@Req() request:FastifyRequest) {
    const input=exactWorkerInput(value,["ticket","partNumbers"]),{id,token}=workerIdentity(headers);
    return {data:await this.work.partUrls(id,token,input.ticket,input.partNumbers),meta:{requestId:request.id}};
  }

  @Post("work/complete")
  @Header("Cache-Control","no-store")
  public async complete(@Body() value:unknown,@Headers() headers:RequestHeaders,@Req() request:FastifyRequest) {
    const optional=value && typeof value==="object" ? Object.keys(value).filter(key=>["result","parts","errorCode"].includes(key)) : [];
    const input=exactWorkerInput(value,["ticket",...optional]),{id,token}=workerIdentity(headers);
    return {data:await this.work.complete(id,token,input.ticket,input.result,input.parts,input.errorCode),meta:{requestId:request.id}};
  }
}

/** Only stable codes reach logs; database/provider messages can contain inputs. */
function admissionErrorCodes(error: unknown): { readonly code: string; readonly databaseCode?: string } {
  const row = error && typeof error === "object" ? error as { readonly code?: unknown; readonly meta?: { readonly code?: unknown } } : {};
  const code = typeof row.code === "string" && /^[A-Z0-9_]{1,32}$/u.test(row.code)
    ? row.code : error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(error.name)
      ? error.name : "UNKNOWN";
  const databaseCode = row.meta?.code;
  return typeof databaseCode === "string" && /^[A-Z0-9_]{1,32}$/u.test(databaseCode)
    ? { code, databaseCode }
    : { code };
}

/** Receipt tokens are issued only after a SQL-verified owning workflow lease. */
@Controller("internal/v1/remote-work")
export class RemoteWorkReceiptController {
  public constructor(private readonly work:RemoteWorkGatewayService) {}
  @Post("receipts")
  @Header("Cache-Control","no-store")
  public async receipts(@Body() value:unknown,@Req() request:FastifyRequest) {
    const input=exactWorkerInput(value,["entries","waitMs"]);
    return {data:await this.work.receipts(input.entries,Number(input.waitMs)),meta:{requestId:request.id}};
  }
}
