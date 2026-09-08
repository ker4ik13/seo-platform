import { Module } from "@nestjs/common";
import { IntegrationModule } from "../integrations/integration.module.js";
import { PaidOperationController } from "./paid-operation.controller.js";
@Module({ imports: [IntegrationModule], controllers: [PaidOperationController] })
export class PaidOperationModule {}
