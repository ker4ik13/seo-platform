import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAppConfig } from "./app-config.js";

describe("loadAppConfig", () => {
  it("parses allowed browser origins", () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      WEB_ORIGINS: "https://app.example.test, https://admin.example.test"
    });

    assert.deepEqual(config.webOrigins, [
      "https://app.example.test",
      "https://admin.example.test"
    ]);
  });

  it("requires a database URL", () => {
    assert.throws(() => loadAppConfig({ NODE_ENV: "test" }), /DATABASE_URL/);
  });

  it("requires internal authentication in production", () => {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://test:test@localhost:5432/test"
        }),
      /INTERNAL_API_TOKEN/
    );
  });
});
