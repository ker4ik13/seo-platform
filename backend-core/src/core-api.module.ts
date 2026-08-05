import {
  Global,
  Module,
  type DynamicModule,
  type Type
} from "@nestjs/common";
import {
  PlatformApiAppModule,
  SEO_DATA_REQUEST_TRANSPORT,
  type SeoDataRequestTransport
} from "@seo-platform/backend-core-api/core-composition";

@Global()
@Module({})
class CoreLocalTransportModule {
  public static register(
    transport: SeoDataRequestTransport
  ): DynamicModule {
    return {
      module: CoreLocalTransportModule,
      global: true,
      providers: [
        { provide: SEO_DATA_REQUEST_TRANSPORT, useValue: transport }
      ],
      exports: [SEO_DATA_REQUEST_TRANSPORT]
    };
  }
}

export function coreApiModule(
  transport: SeoDataRequestTransport
): Type<unknown> {
  @Module({
    imports: [
      CoreLocalTransportModule.register(transport),
      PlatformApiAppModule
    ]
  })
  class CoreApiModule {}

  return CoreApiModule;
}
