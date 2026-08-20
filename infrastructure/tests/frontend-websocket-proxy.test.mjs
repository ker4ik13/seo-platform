import assert from "node:assert/strict";
import test from "node:test";
import {
  isRealtimeUpgradeUrl,
  realtimeInternalOrigin
} from "../../frontend/server.mjs";

test("frontend WebSocket proxy accepts only the exact Socket.IO upgrade path", () => {
  assert.equal(
    isRealtimeUpgradeUrl("/socket.io/?EIO=4&transport=websocket"),
    true
  );
  assert.equal(isRealtimeUpgradeUrl("/socket.io/foreign"), false);
  assert.equal(isRealtimeUpgradeUrl("/other/../socket.io/"), false);
  assert.equal(isRealtimeUpgradeUrl("/socket.io/%2e%2e/socket.io/"), false);
  assert.equal(isRealtimeUpgradeUrl("//attacker.example/socket.io/"), false);
  assert.equal(isRealtimeUpgradeUrl("/app/api/socket.io/"), false);
});

test("frontend WebSocket proxy uses only a canonical internal HTTP origin", () => {
  assert.equal(
    realtimeInternalOrigin({
      REALTIME_INTERNAL_URL: "http://backend-core:4003"
    }).origin,
    "http://backend-core:4003"
  );
  assert.equal(realtimeInternalOrigin({}).origin, "http://127.0.0.1:4003");
  for (const value of [
    "https://backend-core:4003",
    "http://backend-core:4003/socket.io",
    "http://user:secret@backend-core:4003"
  ]) {
    assert.throws(() =>
      realtimeInternalOrigin({ REALTIME_INTERNAL_URL: value })
    );
  }
});
