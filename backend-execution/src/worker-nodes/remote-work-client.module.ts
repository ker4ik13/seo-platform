import { Module } from "@nestjs/common";
import { RemoteWorkClientService } from "./remote-work-client.service.js";

@Module({ providers:[RemoteWorkClientService],exports:[RemoteWorkClientService] })
export class RemoteWorkClientModule {}
