import { BadRequestException } from "@nestjs/common";
import { workerNodeId } from "./worker-node-input.js";

export function workerIdentity(headers:Readonly<Record<string,string|string[]|undefined>>):{ id:string;token:string } {
  const id=workerNodeId(headers["x-worker-id"]),authorization=headers.authorization;
  if(typeof authorization!=="string" || !/^Bearer wn_[A-Za-z0-9_-]{43}$/u.test(authorization)) throw new BadRequestException("Invalid worker authentication");
  return {id,token:authorization.slice(7)};
}
export function exactWorkerInput(value:unknown,fields:readonly string[]):Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new BadRequestException("Invalid worker request");
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==fields.length || fields.some(key=>!Object.hasOwn(row,key))) throw new BadRequestException("Invalid worker request");
  return row;
}
