import assert from "node:assert/strict";
import test from "node:test";
import {
  connectorRouteTrail,
  connectorRoutingScopeLabel,
  hasConnectorFallback
} from "./connector-routing-presentation.ts";

test("renders a safe and readable fallback trail", () => {
  const attempts = [
    {
      sequence: 1,
      provider: "XMLSTOCK" as const,
      routingScope: "PROJECT_OVERRIDE" as const,
      outcome: "FALLBACK" as const,
      reasonCode: "LOW_BALANCE",
      occurredAt: "2026-08-04T12:00:00.000Z"
    },
    {
      sequence: 2,
      provider: "ARSENKIN" as const,
      routingScope: "WORKSPACE_FALLBACK" as const,
      outcome: "SUCCEEDED" as const,
      occurredAt: "2026-08-04T12:00:01.000Z"
    }
  ];
  assert.equal(
    connectorRouteTrail(attempts),
    "XMLStock — недостаточно баланса → Arsenkin Tools — успешно"
  );
  assert.equal(hasConnectorFallback(attempts), true);
  assert.equal(
    connectorRoutingScopeLabel("WORKSPACE_FALLBACK"),
    "Fallback рабочей области"
  );
});

test("does not echo unknown internal reason codes", () => {
  assert.equal(
    connectorRouteTrail([
      {
        sequence: 1,
        provider: "XMLSTOCK",
        routingScope: "WORKSPACE_DEFAULT",
        outcome: "FAILED",
        reasonCode: "PRIVATE_INTERNAL_DETAIL",
        occurredAt: "2026-08-04T12:00:00.000Z"
      }
    ]),
    "XMLStock — ошибка подключения"
  );
});
