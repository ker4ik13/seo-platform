import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const scriptUrl = new URL(
  "../security/validate-service-tokens.sh",
  import.meta.url
);
const scriptPath = fileURLToPath(scriptUrl);
const credentialNames = [
  "PLATFORM_API_TO_SEO_DATA_TOKEN",
  "PLATFORM_API_TO_JOBS_TOKEN",
  "JOBS_TO_SEO_DATA_TOKEN",
  "PLATFORM_API_TO_REALTIME_TOKEN",
  "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
  "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN",
  "JOBS_TO_SEO_RANK_TOKEN",
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "RANK_HISTORY_CURSOR_KEY"
];

test("preflight script is valid POSIX shell and accepts distinct credentials", async () => {
  await execute("/bin/sh", ["-n", scriptPath]);
  const environment = validEnvironment();
  const result = await runPreflight(environment);

  assert.match(
    result.stdout,
    /validated 10 distinct deploy credentials/u
  );
  assert.equal(result.stderr, "");
  assertDoesNotExposeCredentials(
    `${result.stdout}${result.stderr}`,
    environment
  );
});

test("preflight fails closed when a deploy credential is absent", async () => {
  const environment = validEnvironment();
  delete environment.PLATFORM_API_TO_JOBS_TOKEN;

  const failure = await captureFailure(environment);

  assert.match(failure.stderr, /PLATFORM_API_TO_JOBS_TOKEN is required/u);
  assertDoesNotExposeCredentials(failure.stderr, environment);
});

test("preflight rejects a cross-boundary reused credential without logging it", async () => {
  const environment = validEnvironment();
  environment.JOBS_TO_SEO_RANK_TOKEN =
    environment.PLATFORM_API_TO_JOBS_TOKEN;

  const failure = await captureFailure(environment);

  assert.match(
    failure.stderr,
    /JOBS_TO_SEO_RANK_TOKEN must differ from PLATFORM_API_TO_JOBS_TOKEN/u
  );
  assertDoesNotExposeCredentials(failure.stderr, environment);
});

test("preflight rejects placeholders, unsafe characters and invalid length", async () => {
  const cases = [
    {
      name: "PLATFORM_API_TO_SEO_DATA_TOKEN",
      value: "replace-with-a-distinct-random-platform-api-token",
      expected: /must not use an example placeholder/u
    },
    {
      name: "JOBS_TO_SEO_DATA_TOKEN",
      value: `${"s".repeat(40)},redirect`,
      expected: /must be URL-safe/u
    },
    {
      name: "PLATFORM_API_TO_REALTIME_TOKEN",
      value: `${"s".repeat(40)}\n`,
      expected: /must be URL-safe/u
    },
    {
      name: "RANK_HISTORY_CURSOR_KEY",
      value: "too-short",
      expected: /must contain 32\.\.512 characters/u
    }
  ];

  for (const invalidCase of cases) {
    const environment = validEnvironment();
    environment[invalidCase.name] = invalidCase.value;
    const failure = await captureFailure(environment);

    assert.match(failure.stderr, invalidCase.expected);
    assertDoesNotExposeCredentials(failure.stderr, environment);
  }
});

async function runPreflight(environment) {
  return execute("/bin/sh", [scriptPath], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      ...environment
    }
  });
}

async function captureFailure(environment) {
  try {
    await runPreflight(environment);
  } catch (error) {
    assert.equal(typeof error, "object");
    assert.notEqual(error, null);
    assert.notEqual(error.code, 0);
    return {
      stderr: String(error.stderr ?? ""),
      stdout: String(error.stdout ?? "")
    };
  }
  assert.fail("service-token-preflight must fail closed");
}

function validEnvironment() {
  return Object.fromEntries(
    credentialNames.map((name, index) => [
      name,
      `generated-${index}-${"x".repeat(48)}`
    ])
  );
}

function assertDoesNotExposeCredentials(output, environment) {
  for (const value of Object.values(environment)) {
    assert.equal(
      output.includes(value),
      false,
      "preflight output must not contain credential material"
    );
  }
}
