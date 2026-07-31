import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(
  new URL("../compose.dokploy.yml", import.meta.url),
  "utf8"
);
const permissions = readFileSync(
  new URL(
    "../postgres/permissions/realtime-web-push.sql",
    import.meta.url
  ),
  "utf8"
);
const hba = readFileSync(
  new URL("../postgres/config/start-postgres.sh", import.meta.url),
  "utf8"
);

test("isolates the VAPID private key in the outbound-only worker profile", () => {
  const realtime = service("realtime", "web-push-worker");
  const worker = service("web-push-worker", "web");

  assert.match(realtime, /SERVICE_ROLE: HTTP/u);
  assert.match(realtime, /WEB_PUSH_DELIVERY_AVAILABLE/u);
  assert.doesNotMatch(realtime, /WEB_PUSH_VAPID_PRIVATE_KEY/u);
  assert.doesNotMatch(realtime, /WEB_PUSH_DELIVERY_ENABLED/u);

  assert.match(worker, /profiles: \["web-push"\]/u);
  assert.match(worker, /SERVICE_ROLE: WEB_PUSH_WORKER/u);
  assert.match(worker, /dist\/web-push-worker\.main\.js/u);
  assert.match(worker, /WEB_PUSH_VAPID_PRIVATE_KEY/u);
  assert.match(worker, /PLATFORM_API_INTERNAL_URL/u);
  assert.match(worker, /REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN/u);
  assert.match(worker, /- outbound/u);
  for (const forbidden of [
    "PLATFORM_API_TO_REALTIME_TOKEN",
    "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN",
    "NATS_USER",
    "NATS_PASSWORD",
    "REDIS_URL",
    "WEB_ORIGINS"
  ]) {
    assert.doesNotMatch(worker, new RegExp(forbidden, "u"));
  }
});

test("grants the sender only bounded Realtime notification tables", () => {
  assert.match(permissions, /GRANT SELECT ON TABLE public\.notifications/u);
  assert.match(
    permissions,
    /GRANT SELECT ON TABLE public\.web_push_encryption_key_canaries/u
  );
  assert.match(
    permissions,
    /GRANT SELECT ON TABLE public\.web_push_fingerprint_key_canaries/u
  );
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
  assert.match(hba, /realtime_web_push/u);
});

function service(name, nextName) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  const end = compose.indexOf(`\n  ${nextName}:\n`, start + 1);
  assert.notEqual(start, -1, `${name} service is missing`);
  assert.notEqual(end, -1, `${nextName} service boundary is missing`);
  return compose.slice(start, end);
}
