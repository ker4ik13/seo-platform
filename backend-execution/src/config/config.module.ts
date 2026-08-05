import { Global, Module, type DynamicModule } from "@nestjs/common";
import {
  loadAppConfig,
  type AppConfig,
  type JobsProcessRole
} from "./app-config.js";

export const APP_CONFIG = Symbol("APP_CONFIG");

@Global()
@Module({})
export class ConfigModule {
  public static forRole(processRole: JobsProcessRole): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [
        {
          provide: APP_CONFIG,
          useFactory: (): AppConfig =>
            loadAppConfig(process.env, processRole)
        }
      ],
      exports: [APP_CONFIG]
    };
  }
}
