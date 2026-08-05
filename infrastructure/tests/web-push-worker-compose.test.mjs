import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(
  new URL("../compose.dokploy.yml", import.meta.url),
  "utf8"
);
const runtime = readFileSync(
  new URL("../../backend-core/src/runtime-processes.ts", import.meta.url),
  "utf8"
);
const permissions = readFileSync(
  new URL("../postgres/permissions/realtime-web-push.sql", import.meta.url),
  "utf8"
);
const provisioner = readFileSync(
  new URL(
    "../postgres/permissions/provision-realtime-web-push-role.sh",
    import.meta.url
  ),
  "utf8"
);

test("web push is an opt-in scoped child of backend-core", () => {
  const core = serviceBlock(compose, "backend-core");
  assert.doesNotMatch(compose, /^  web-push-worker:$/mu);
  assert.match(core, /WEB_PUSH_DELIVERY_ENABLED:/u);
  assert.match(core, /WEB_PUSH_DATABASE_URL:/u);
  assert.match(runtime, /env\.WEB_PUSH_DELIVERY_ENABLED === "true"/u);
  assert.match(runtime, /name: "web-push"/u);
  assert.match(runtime, /SERVICE_ROLE: "WEB_PUSH_WORKER"/u);

  const realtimeKeys = runtime.slice(
    runtime.indexOf("const REALTIME_KEYS"),
    runtime.indexOf("const WEB_PUSH_KEYS")
  );
  assert.doesNotMatch(realtimeKeys, /WEB_PUSH_VAPID_PRIVATE_KEY/u);
  const webPushKeys = runtime.slice(
    runtime.indexOf("const WEB_PUSH_KEYS"),
    runtime.indexOf("export function")
  );
  assert.match(webPushKeys, /WEB_PUSH_VAPID_PRIVATE_KEY/u);
});

test("the sender retains only bounded Realtime table grants", () => {
  assert.match(permissions, /GRANT SELECT ON TABLE public\.notifications/u);
  assert.match(
    permissions,
    /GRANT SELECT ON TABLE public\.web_push_delivery_attempts/u
  );
  assert.match(
    permissions,
    /GRANT UPDATE \([\s\S]*?\) ON TABLE public\.web_push_delivery_attempts/u
  );
  assert.match(
    permissions,
    /GRANT SELECT ON TABLE public\.web_push_subscriptions/u
  );
  assert.doesNotMatch(permissions, /GRANT (?:INSERT|DELETE|ALL)/u);
});

test("the Web Push role rejects weak deployment passwords before psql", () => {
  const unsetIndex = provisioner.indexOf(
    "unset REALTIME_WEB_PUSH_DATABASE_PASSWORD"
  );
  const firstPsqlIndex = provisioner.indexOf("psql \\");

  assert.ok(unsetIndex >= 0);
  assert.ok(firstPsqlIndex > unsetIndex);
  assert.match(
    provisioner,
    /REALTIME_WEB_PUSH_DATABASE_PASSWORD must contain 32\.\.512 characters/u
  );
  assert.match(
    provisioner,
    /REALTIME_WEB_PUSH_DATABASE_PASSWORD must be URL-safe/u
  );
  assert.match(
    provisioner,
    /REALTIME_WEB_PUSH_DATABASE_PASSWORD must not use an example placeholder/u
  );
});

function serviceBlock(document, serviceName) {
  const lines = document.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `${serviceName} service must exist`);
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^  [a-z0-9][a-z0-9-]*:\s*$/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}
