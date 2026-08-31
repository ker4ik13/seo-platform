import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";
import {
  createOperationalAlertClient,
  installUncaughtExceptionAlert,
  localFingerprint
} from "@seo-platform/operational-alerts";
import next from "next";

const REALTIME_PATH = "/socket.io/";
const PROXY_TIMEOUT_MILLISECONDS = 8_000;

export function realtimeInternalOrigin(env = process.env) {
  const value = env.REALTIME_INTERNAL_URL ?? "http://127.0.0.1:4003";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("REALTIME_INTERNAL_URL must be a canonical HTTP origin");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value
  ) {
    throw new Error("REALTIME_INTERNAL_URL must be a canonical HTTP origin");
  }
  return parsed;
}

export function isRealtimeUpgradeUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return false;
  }
  try {
    const parsed = new URL(value, "http://internal.invalid");
    const queryIndex = value.indexOf("?");
    const rawPath = queryIndex === -1 ? value : value.slice(0, queryIndex);
    return rawPath === REALTIME_PATH && parsed.pathname === REALTIME_PATH;
  } catch {
    return false;
  }
}

export async function startFrontendServer(env = process.env) {
  const alerts = createOperationalAlertClient(env, "frontend");
  const removeExceptionMonitor = installUncaughtExceptionAlert(alerts);
  const development = env.NODE_ENV !== "production";
  const hostname = env.HOSTNAME || "127.0.0.1";
  const port = boundedPort(env.PORT ?? "3000");
  const realtime = realtimeInternalOrigin(env);
  const app = next({ dev: development, hostname, port });
  await app.prepare();
  const handleRequest = app.getRequestHandler();
  const handleNextUpgrade = app.getUpgradeHandler();
  const server = createServer((request, response) => {
    void Promise.resolve(handleRequest(request, response)).catch((error) => {
      capture(alerts, "next-request", "REQUEST_HANDLER_FAILURE", error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (!isRealtimeUpgradeUrl(request.url)) {
      void Promise.resolve(handleNextUpgrade(request, socket, head)).catch(
        (error) => {
          capture(alerts, "next-upgrade", "UPGRADE_HANDLER_FAILURE", error);
          socket.destroy();
        }
      );
      return;
    }
    proxyRealtimeUpgrade(request, socket, head, realtime, alerts);
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const shutdown = () => {
    server.close(() => {
      removeExceptionMonitor();
      void alerts.flush().finally(() => process.exit(0));
    });
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.once("close", removeExceptionMonitor);
  return server;
}

function proxyRealtimeUpgrade(
  request,
  browserSocket,
  head,
  target,
  alerts
) {
  const headers = { ...request.headers };
  delete headers.authorization;
  delete headers.cookie;
  delete headers["proxy-authorization"];
  delete headers.forwarded;
  delete headers["x-forwarded-for"];
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];
  headers.host = target.host;

  const upstreamRequest = httpRequest({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: "GET",
    path: request.url,
    headers
  });
  upstreamRequest.setTimeout(PROXY_TIMEOUT_MILLISECONDS, () => {
    capture(
      alerts,
      "realtime-proxy",
      "REALTIME_UPSTREAM_TIMEOUT",
      "timeout"
    );
    upstreamRequest.destroy();
    browserSocket.destroy();
  });
  upstreamRequest.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    upstreamSocket.setTimeout(0);
    browserSocket.setTimeout(0);
    browserSocket.write(rawHttpResponse(response));
    if (upstreamHead.length > 0) browserSocket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    browserSocket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", (error) => {
      capture(
        alerts,
        "realtime-proxy",
        "REALTIME_UPSTREAM_SOCKET_FAILURE",
        error
      );
      browserSocket.destroy();
    });
    browserSocket.on("close", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => browserSocket.destroy());
    browserSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(browserSocket);
  });
  upstreamRequest.on("response", (response) => {
    browserSocket.write(rawHttpResponse(response));
    response.pipe(browserSocket);
  });
  upstreamRequest.on("error", (error) => {
    capture(
      alerts,
      "realtime-proxy",
      "REALTIME_UPSTREAM_REQUEST_FAILURE",
      error
    );
    browserSocket.destroy();
  });
  browserSocket.on("close", () => upstreamRequest.destroy());
  upstreamRequest.end();
}

function capture(alerts, source, code, error) {
  try {
    alerts.capture({
      source,
      code,
      severity: "ERROR",
      fingerprint: localFingerprint(error)
    });
  } catch {
    process.stderr.write("[frontend] alert capture unavailable\n");
  }
}

function rawHttpResponse(response) {
  const status = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`;
  let headers = "";
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    headers += `${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`;
  }
  return `${status}${headers}\r\n`;
}

function boundedPort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

const mainModule = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;
if (mainModule) await startFrontendServer();
