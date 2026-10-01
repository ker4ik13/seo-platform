import { BadRequestException,Body,Controller,Header,Headers,Post,Req } from "@nestjs/common";
import { parseRemoteWorkClaim,type ApiResponse,type RemoteRankPollTaskV1,type RemoteWorkTask } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { RemoteWorkGatewayService } from "./remote-work-gateway.service.js";
import { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { workerIdentity,exactWorkerInput } from "./worker-wire-input.js";

type RequestHeaders=Readonly<Record<string,string|string[]|undefined>>;

@Controller("worker/v1")
export class RemoteWorkController {
  public constructor(private readonly work:RemoteWorkGatewayService,private readonly ranks:WorkerRankGatewayService,private readonly nodes:WorkerNodeService) {}

  @Post("claim")
  @Header("Cache-Control","no-store")
  public async claim(@Body() value:unknown,@Headers() headers:RequestHeaders,@Req() request:FastifyRequest):Promise<ApiResponse<{work:readonly RemoteWorkTask[];ranks:readonly RemoteRankPollTaskV1[];cancelled:readonly string[]}>> {
    let input; try { input=parseRemoteWorkClaim(value); } catch { throw new BadRequestException("Invalid worker capacity"); }
    const {id,token}=workerIdentity(headers);
    const node=await this.nodes.authorizeCombinedWork(id,token);
    const rankSlots=node.capabilities.includes("RANK") ? Math.min(input.capabilitySlots.RANK ?? 0,input.httpSlots) : 0;
    const initialRank=Math.min(rankSlots,Math.ceil(input.httpSlots/2));
    const ranks=[...(initialRank>0 ? await this.ranks.claimBatch(id,token,initialRank) : [])];
    const work=await this.work.claim(id,token,{...input,httpSlots:Math.max(0,input.httpSlots-ranks.length),capabilitySlots:{...input.capabilitySlots,RANK:Math.max(0,rankSlots-ranks.length)}});
    const remaining=Math.max(0,input.httpSlots-ranks.length-work.filter(task=>task.resource==="HTTP").length);
    if(remaining>0 && rankSlots>ranks.length) ranks.push(...await this.ranks.claimBatch(id,token,Math.min(remaining,rankSlots-ranks.length)));
    return {data:{work,ranks,cancelled:await this.work.cancelled(id)},meta:{requestId:request.id}};
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
