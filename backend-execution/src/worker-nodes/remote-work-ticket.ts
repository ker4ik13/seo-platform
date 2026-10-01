import { createHmac,hkdfSync,timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/app-config.js";

export interface RemoteWorkTicket { readonly version:1; readonly keyVersion:number; readonly id:string; readonly nodeId:string; readonly leaseToken:string; readonly payloadHash:string; readonly expiresAt:string; }
export function signRemoteWorkTicket(config:AppConfig,value:Omit<RemoteWorkTicket,"version"|"keyVersion">):string {
  const keyVersion=config.integrationCredentials.activeKeyVersion;
  if (!keyVersion) invalid();
  const ticket={ version:1 as const,keyVersion,...value };
  validate(ticket);
  const data=Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `wwt1.${data}.${mac(config,keyVersion,data).toString("base64url")}`;
}
export function verifyRemoteWorkTicket(config:AppConfig,value:unknown,nodeId:string):RemoteWorkTicket {
  if (typeof value!=="string" || value.length>4096) invalid();
  const [prefix,data,signature,...extra]=value.split(".");
  if(prefix!=="wwt1" || !data || !signature || extra.length || !/^[A-Za-z0-9_-]+$/u.test(data) || !/^[A-Za-z0-9_-]+$/u.test(signature)) invalid();
  let payload:unknown; try { payload=JSON.parse(Buffer.from(data,"base64url").toString("utf8")); } catch { invalid(); }
  const ticket=validate(payload), actual=Buffer.from(signature,"base64url"), expected=mac(config,ticket.keyVersion,data);
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected) || ticket.nodeId!==nodeId || Date.parse(ticket.expiresAt)<=Date.now()) invalid();
  return ticket;
}
function mac(config:AppConfig,version:number,data:string):Buffer {
  const master=config.integrationCredentials.keys.get(version); if(!master || master.length!==32) invalid();
  const key=hkdfSync("sha256",master,Buffer.alloc(0),Buffer.from("seo-platform.remote-work-ticket.v1"),32);
  return createHmac("sha256",Buffer.from(key)).update(data).digest();
}
function validate(value:unknown):RemoteWorkTicket {
  if(!value || typeof value!=="object" || Array.isArray(value)) invalid();
  const row=value as Record<string,unknown>;
  const fields=["version","keyVersion","id","nodeId","leaseToken","payloadHash","expiresAt"];
  if(Object.keys(row).length!==fields.length || fields.some(key=>!Object.hasOwn(row,key)) || row.version!==1 ||
    !Number.isSafeInteger(row.keyVersion) || Number(row.keyVersion)<1 || Number(row.keyVersion)>255 ||
    [row.id,row.nodeId,row.leaseToken].some(id=>typeof id!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) ||
    typeof row.payloadHash!=="string" || !/^[a-f0-9]{64}$/u.test(row.payloadHash) || typeof row.expiresAt!=="string" || !Number.isFinite(Date.parse(row.expiresAt))) invalid();
  return row as unknown as RemoteWorkTicket;
}
function invalid():never { throw new TypeError("Invalid remote work ticket"); }
