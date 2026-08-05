import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { seoDataLocalTransport } from "./seo-data-local-transport.js";

test("dispatches SEO Data requests in-process without changing the contract", async () => {
  const server = Fastify();
  server.post("/internal/v1/projects/:projectId/example", async (request) => ({
    data: {
      projectId: (request.params as { projectId: string }).projectId,
      workspaceId: request.headers["x-workspace-id"],
      body: request.body
    },
    meta: { requestId: request.headers["x-request-id"] }
  }));
  await server.ready();
  try {
    const response = await seoDataLocalTransport(server).request({
      method: "POST",
      url: new URL(
        "http://seo-data:4001/internal/v1/projects/project-1/example"
      ),
      headers: {
        "content-type": "application/json",
        "x-request-id": "request-1",
        "x-workspace-id": "workspace-1"
      },
      body: JSON.stringify({ value: 1 }),
      timeoutMs: 1_000
    });
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: {
        projectId: "project-1",
        workspaceId: "workspace-1",
        body: { value: 1 }
      },
      meta: { requestId: "request-1" }
    });
  } finally {
    await server.close();
  }
});
