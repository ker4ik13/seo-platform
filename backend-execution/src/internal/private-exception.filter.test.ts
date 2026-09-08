import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, type ArgumentsHost } from "@nestjs/common";
import { PrivateExceptionFilter } from "./private-exception.filter.js";

test("private errors preserve domain outcomes and never log raw exception data", () => {
  const filter = new PrivateExceptionFilter(), logged: unknown[] = [];
  Object.defineProperty(filter, "logger", { value: { error: (value: unknown) => logged.push(value) } });
  let status: number | undefined, body: unknown;
  const reply = { status: (value: number) => { status = value; return reply; }, send: (value: unknown) => { body = value; } };
  const host = { switchToHttp: () => ({ getRequest: () => ({ id: "safe-request-id" }), getResponse: () => reply }) } as unknown as ArgumentsHost;
  filter.catch(new Error("private database row, provider token, email"), host);
  assert.equal(status, 500);
  assert.equal(JSON.stringify({ logged, body }).includes("private database row"), false);
  assert.deepEqual(logged, [{ event: "private_request_failed", exceptionType: "Error", requestId: "safe-request-id" }]);
  const domain = { error: { code: "ESTIMATE_STALE", message: "Recalculate the operation" } };
  filter.catch(new HttpException(domain, 409), host);
  assert.equal(status, 409); assert.deepEqual(body, domain); assert.equal(logged.length, 1);
});
