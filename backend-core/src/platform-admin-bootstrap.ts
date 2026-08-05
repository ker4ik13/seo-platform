interface PlatformAdminBootstrapModule {
  readonly runPlatformAdminBootstrap: () => Promise<void>;
}

try {
  const bootstrapModule: unknown = await import(
    "@seo-platform/backend-core-api/platform-admin-bootstrap"
  );
  if (!isPlatformAdminBootstrapModule(bootstrapModule)) {
    throw new Error("Platform admin bootstrap entrypoint is unavailable");
  }
  await bootstrapModule.runPlatformAdminBootstrap();
} catch (error: unknown) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Bootstrap failed"}\n`
  );
  process.exitCode = 1;
}

function isPlatformAdminBootstrapModule(
  value: unknown
): value is PlatformAdminBootstrapModule {
  return Boolean(
    value &&
      typeof value === "object" &&
      "runPlatformAdminBootstrap" in value &&
      typeof value.runPlatformAdminBootstrap === "function"
  );
}
