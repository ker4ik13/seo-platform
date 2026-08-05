import { Module } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { DisabledObjectStorageAdapter } from "./disabled-object-storage.adapter.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort
} from "./object-storage.port.js";
import { S3ObjectStorageAdapter } from "./s3-object-storage.adapter.js";

@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStoragePort =>
        config.s3.enabled
          ? new S3ObjectStorageAdapter(config.s3)
          : new DisabledObjectStorageAdapter()
    }
  ],
  exports: [OBJECT_STORAGE]
})
export class StorageModule {}
