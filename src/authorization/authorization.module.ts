import { Global, Module } from "@nestjs/common";
import { AuthorizationService } from "./authorization.service.js";
import { TenantPermissionGuard } from "./tenant-permission.guard.js";

@Global()
@Module({
  providers: [AuthorizationService, TenantPermissionGuard],
  exports: [AuthorizationService, TenantPermissionGuard]
})
export class AuthorizationModule {}
