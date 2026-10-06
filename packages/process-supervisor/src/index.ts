import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

export interface ProcessDefinition {
  readonly name: string;
  readonly moduleUrl: URL;
  readonly environment: NodeJS.ProcessEnv;
}

export interface ProcessAlertReporter {
  capture(alert: {
    readonly source: string;
    readonly code: string;
    readonly severity: "ERROR" | "CRITICAL";
    readonly fingerprint?: string;
    readonly context?: Readonly<Record<string, string>>;
  }): boolean;
  flush(): Promise<void>;
}

export interface ProcessSupervisorOptions {
  readonly alertReporter?: ProcessAlertReporter;
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
  definitions: readonly ProcessDefinition[],
  options: ProcessSupervisorOptions = {}
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
              stdio: ["inherit", "inherit", "pipe"]
            }
          );
          children.set(definition.name, child);
          observeStderr(child, definition.name, options.alertReporter);
          child.once("error", (error) => {
            captureAlert(options.alertReporter, {
              source: definition.name,
              code: "PROCESS_START_FAILURE",
              severity: "CRITICAL",
              fingerprint: privateFingerprint(error)
            });
            failure ??= new Error(
              `${definition.name} failed to start`,
              { cause: error }
            );
            stop("SIGTERM");
          });
          child.once("close", (code, signal) => {
            children.delete(definition.name);
            if (!stopping && (code !== 0 || signal !== null)) {
              captureAlert(options.alertReporter, {
                source: definition.name,
                code: "UNEXPECTED_PROCESS_EXIT",
                severity: "CRITICAL",
                fingerprint: privateFingerprint(
                  `${code ?? "NO_CODE"}:${signal ?? "NO_SIGNAL"}`
                )
              });
              failure ??= new Error(
                `${definition.name} exited unexpectedly (${signal ?? code ?? "unknown"})`
              );
              stop("SIGTERM");
            } else if (!stopping) {
              captureAlert(options.alertReporter, {
                source: definition.name,
                code: "UNEXPECTED_PROCESS_STOP",
                severity: "CRITICAL"
              });
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
    try {
      await options.alertReporter?.flush();
    } catch {
      process.stderr.write("[process-supervisor] alert flush unavailable\n");
    }
  }
  if (failure) throw failure;
}

export function supervisedErrorLineFingerprint(
  line: string
): string | undefined {
  const withoutAnsi = line.replaceAll(
    new RegExp(
      `${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`,
      "gu"
    ),
    ""
  );
  const printable = Array.from(withoutAnsi, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 8 || code === 11 || code === 12 ||
      (code >= 14 && code <= 31) || code === 127
      ? " "
      : character;
  }).join("");
  if (
    !/(?:\b(?:error|fatal)\b|uncaught(?:exception)?|unhandled rejection)/iu.test(
      printable
    )
  ) {
    return undefined;
  }
  return privateFingerprint(line);
}

function observeStderr(
  child: ChildProcess,
  source: string,
  reporter: ProcessAlertReporter | undefined
): void {
  if (!child.stderr) return;
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const inspect = (line: string): void => {
    const fingerprint = supervisedErrorLineFingerprint(line);
    if (!fingerprint) return;
    captureAlert(reporter, {
      source,
      code: "CHILD_ERROR_LOG",
      severity: "ERROR",
      fingerprint,
      context: supervisedErrorContext(line)
    });
  };
  child.stderr.on("data", (chunk: Buffer | string) => {
    process.stderr.write(chunk);
    pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline === -1) break;
      inspect(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
    if (pending.length > 65_536) {
      inspect(pending);
      pending = "";
    }
  });
  child.stderr.once("end", () => {
    pending += decoder.end();
    if (pending) inspect(pending);
  });
}

export function supervisedErrorExcerpt(line: string): string {
  const redacted = line
    .replaceAll(
      new RegExp(
        `${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`,
        "gu"
      ),
      ""
    )
    .replace(/\b(?:postgres(?:ql)?|redis|https?):\/\/\S+/giu, "[redacted-url]")
    .replace(/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\b\s*[:=]\s*\S+/giu, "[redacted-secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]");
  return Array.from(redacted, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 128) || "error log line unavailable";
}

export function supervisedErrorContext(line: string): Readonly<Record<string, string>> {
  const context: Record<string, string> = { log: supervisedErrorExcerpt(line) };
  if (!line.includes("rank_result_persist_failed")) return context;
  for (const key of ["workspaceId", "projectId", "jobId"] as const) {
    const value = new RegExp(`\\b${key}=([0-9a-f-]{36})\\b`, "iu").exec(line)?.[1];
    if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
      context[key] = value;
    }
  }
  const errorCode = /\berrorCode=(P\d{4})\b/u.exec(line)?.[1];
  if (errorCode) context.errorCode = errorCode;
  return context;
}

function captureAlert(
  reporter: ProcessAlertReporter | undefined,
  alert: Parameters<ProcessAlertReporter["capture"]>[0]
): void {
  try {
    reporter?.capture(alert);
  } catch {
    process.stderr.write("[process-supervisor] alert capture unavailable\n");
  }
}

function privateFingerprint(value: unknown): string {
  const preimage =
    value instanceof Error
      ? `${value.name}\u0000${value.stack ?? "NO_STACK"}`
      : String(value);
  return createHash("sha256")
    .update(preimage, "utf8")
    .digest("hex")
    .slice(0, 16);
}
