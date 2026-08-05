import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ProcessDefinition {
  readonly name: string;
  readonly moduleUrl: URL;
  readonly environment: NodeJS.ProcessEnv;
}

const SAFE_BASE_ENVIRONMENT_KEYS = [
  "HOME",
  "HOSTNAME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NO_PROXY",
  "PATH",
  "SERVICE_VERSION",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TZ",
  "http_proxy",
  "https_proxy",
  "no_proxy"
] as const;

export function processEnvironment(
  source: NodeJS.ProcessEnv,
  allowedKeys: readonly string[],
  overrides: Readonly<Record<string, string | undefined>> = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [...SAFE_BASE_ENVIRONMENT_KEYS, ...allowedKeys]) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

export async function superviseProcesses(
  definitions: readonly ProcessDefinition[]
): Promise<void> {
  if (definitions.length === 0) {
    throw new Error("At least one supervised process is required");
  }
  const names = new Set<string>();
  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(definition.name)) {
      throw new Error(`Invalid supervised process name: ${definition.name}`);
    }
    if (names.has(definition.name)) {
      throw new Error(`Duplicate supervised process: ${definition.name}`);
    }
    names.add(definition.name);
  }

  const children = new Map<string, ChildProcess>();
  let stopping = false;
  let failure: Error | undefined;

  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    }
  };

  const signalHandler = (signal: NodeJS.Signals): void => stop(signal);
  process.once("SIGINT", signalHandler);
  process.once("SIGTERM", signalHandler);

  try {
    const exits = definitions.map(
      (definition) =>
        new Promise<void>((resolve) => {
          const child = spawn(
            process.execPath,
            [fileURLToPath(definition.moduleUrl)],
            {
              env: definition.environment,
              stdio: "inherit"
            }
          );
          children.set(definition.name, child);
          child.once("error", (error) => {
            failure ??= new Error(
              `${definition.name} failed to start`,
              { cause: error }
            );
            stop("SIGTERM");
          });
          child.once("close", (code, signal) => {
            children.delete(definition.name);
            if (!stopping && (code !== 0 || signal !== null)) {
              failure ??= new Error(
                `${definition.name} exited unexpectedly (${signal ?? code ?? "unknown"})`
              );
              stop("SIGTERM");
            } else if (!stopping) {
              failure ??= new Error(
                `${definition.name} stopped while the service was running`
              );
              stop("SIGTERM");
            }
            resolve();
          });
        })
    );
    await Promise.all(exits);
  } finally {
    process.off("SIGINT", signalHandler);
    process.off("SIGTERM", signalHandler);
  }
  if (failure) throw failure;
}
