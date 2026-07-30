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
  "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN",
  "RANK_HISTORY_CURSOR_KEY",
  "REDIS_JOBS_API_PASSWORD",
  "REDIS_JOBS_SYSTEM_PASSWORD",
  "REDIS_JOBS_INSPECTION_PASSWORD",
  "REDIS_JOBS_IMPORT_PASSWORD",
  "REDIS_JOBS_RANK_PASSWORD",
  "REDIS_JOBS_CONNECTOR_PASSWORD",
  "REDIS_REALTIME_PASSWORD",
  "REDIS_DIRECTUS_PASSWORD",
  "NATS_RUNTIME_PASSWORD",
  "NATS_PLATFORM_PUBLISHER_PASSWORD",
  "NATS_REALTIME_CONSUMER_PASSWORD",
  "NATS_AUTH_EMAIL_CONSUMER_PASSWORD",
  "NATS_PROVISIONER_PASSWORD"
];
const usernameNames = [
  "NATS_RUNTIME_USER",
  "NATS_PLATFORM_PUBLISHER_USER",
  "NATS_REALTIME_CONSUMER_USER",
  "NATS_AUTH_EMAIL_CONSUMER_USER",
  "NATS_PROVISIONER_USER"
];
const natsPasswordHashNames = [
  "NATS_RUNTIME_PASSWORD_HASH",
  "NATS_PLATFORM_PUBLISHER_PASSWORD_HASH",
  "NATS_REALTIME_CONSUMER_PASSWORD_HASH",
  "NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH",
  "NATS_PROVISIONER_PASSWORD_HASH"
];
const natsPasswordHashes = [
  "$2a$11$SnmJ/ftus.QHSRgvQK4xkucVtf5ucK25GsOSsjVPJem9i2U5txZFK",
  "$2a$11$PDhMidnaWsRKmptE4e0hEeNHwtbSknwwAJMGSY4YxwW2gu03q.Ena",
  "$2a$11$biu94pm9wRs6z9rIuer3letiCffv/X59tkqkxr7oWhaiUMdKsV/DK",
  "$2a$11$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "$2a$11$YSHwX16VLEEE/MFWc6s9auKSXYjddbpGTVlOuZpWZvuoIIYZ6aYP."
];
const smtpCredentialNames = [
  "AUTH_EMAIL_SMTP_USER",
  "AUTH_EMAIL_SMTP_PASSWORD",
  "DIRECTUS_SMTP_USER",
  "DIRECTUS_SMTP_PASSWORD"
];

test("preflight script is valid POSIX shell and accepts distinct credentials", async () => {
  await execute("/bin/sh", ["-n", scriptPath]);
  const environment = validEnvironment();
  const result = await runPreflight(environment);

  assert.match(
    result.stdout,
    /validated 24 distinct deploy credentials, 5 distinct NATS bcrypt verifiers and 5 distinct NATS usernames/u
  );
  assert.equal(result.stderr, "");
  assertDoesNotExposeCredentials(
    `${result.stdout}${result.stderr}`,
    environment
  );
});

test("preflight accepts generated URL-safe credentials containing hyphens", async () => {
  const environment = validEnvironment();
  environment.NATS_RUNTIME_PASSWORD =
    "generated-runtime-password-with-many-hyphens-123456";

  const result = await runPreflight(environment);

  assert.equal(result.stderr, "");
  assertDoesNotExposeCredentials(result.stdout, environment);
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

test("preflight rejects service-token and NATS password reuse without logging it", async () => {
  const environment = validEnvironment();
  environment.NATS_REALTIME_CONSUMER_PASSWORD =
    environment.PLATFORM_API_TO_REALTIME_TOKEN;

  const failure = await captureFailure(environment);

  assert.match(
    failure.stderr,
    /NATS_REALTIME_CONSUMER_PASSWORD must differ from PLATFORM_API_TO_REALTIME_TOKEN/u
  );
  assertDoesNotExposeCredentials(failure.stderr, environment);
});

test("preflight rejects Redis credential reuse across process boundaries", async () => {
  const environment = validEnvironment();
  environment.REDIS_JOBS_CONNECTOR_PASSWORD =
    environment.REDIS_JOBS_API_PASSWORD;

  const failure = await captureFailure(environment);

  assert.match(
    failure.stderr,
    /REDIS_JOBS_CONNECTOR_PASSWORD must differ from REDIS_JOBS_API_PASSWORD/u
  );
  assertDoesNotExposeCredentials(failure.stderr, environment);
});

test("preflight requires isolated auth-email and Directus SMTP credentials", async () => {
  const missing = validEnvironment();
  delete missing.AUTH_EMAIL_SMTP_PASSWORD;
  const missingFailure = await captureFailure(missing);
  assert.match(
    missingFailure.stderr,
    /AUTH_EMAIL_SMTP_PASSWORD is required/u
  );
  assertDoesNotExposeCredentials(missingFailure.stderr, missing);

  const partialDirectus = validEnvironment();
  partialDirectus.DIRECTUS_SMTP_PASSWORD = "";
  const partialFailure = await captureFailure(partialDirectus);
  assert.match(
    partialFailure.stderr,
    /DIRECTUS_SMTP_USER and DIRECTUS_SMTP_PASSWORD must be configured together/u
  );
  assertDoesNotExposeCredentials(partialFailure.stderr, partialDirectus);

  for (const reusedName of ["DIRECTUS_SMTP_USER", "DIRECTUS_SMTP_PASSWORD"]) {
    const reused = validEnvironment();
    const authName = reusedName.replace("DIRECTUS", "AUTH_EMAIL");
    reused[reusedName] = reused[authName];
    const reusedFailure = await captureFailure(reused);
    assert.match(
      reusedFailure.stderr,
      new RegExp(`${reusedName} must differ from ${authName}`, "u")
    );
    assertDoesNotExposeCredentials(reusedFailure.stderr, reused);
  }

  const serviceTokenReuse = validEnvironment();
  serviceTokenReuse.AUTH_EMAIL_SMTP_PASSWORD =
    serviceTokenReuse.PLATFORM_API_TO_JOBS_TOKEN;
  const serviceTokenFailure = await captureFailure(serviceTokenReuse);
  assert.match(
    serviceTokenFailure.stderr,
    /AUTH_EMAIL_SMTP_PASSWORD must differ from PLATFORM_API_TO_JOBS_TOKEN/u
  );
  assertDoesNotExposeCredentials(
    serviceTokenFailure.stderr,
    serviceTokenReuse
  );
});

test("preflight rejects duplicate or unsafe NATS usernames", async () => {
  const duplicate = validEnvironment();
  duplicate.NATS_PROVISIONER_USER = duplicate.NATS_RUNTIME_USER;
  const duplicateFailure = await captureFailure(duplicate);
  assert.match(
    duplicateFailure.stderr,
    /NATS_PROVISIONER_USER must differ from NATS_RUNTIME_USER/u
  );
  assertDoesNotExposeCredentials(duplicateFailure.stderr, duplicate);

  const unsafe = validEnvironment();
  unsafe.NATS_REALTIME_CONSUMER_USER = "9 invalid";
  const unsafeFailure = await captureFailure(unsafe);
  assert.match(
    unsafeFailure.stderr,
    /NATS_REALTIME_CONSUMER_USER must start with an ASCII letter/u
  );
  assertDoesNotExposeCredentials(unsafeFailure.stderr, unsafe);

  const reusedAsPassword = validEnvironment();
  const reusedValue = "SharedNatsIdentity_123456789012345678901";
  reusedAsPassword.NATS_RUNTIME_USER = reusedValue;
  reusedAsPassword.NATS_RUNTIME_PASSWORD = reusedValue;
  const reusedFailure = await captureFailure(reusedAsPassword);
  assert.match(
    reusedFailure.stderr,
    /NATS_RUNTIME_USER must differ from NATS_RUNTIME_PASSWORD/u
  );
  assertDoesNotExposeCredentials(reusedFailure.stderr, reusedAsPassword);
});

test("preflight rejects missing malformed or reused NATS bcrypt verifiers", async () => {
  const missing = validEnvironment();
  delete missing.NATS_RUNTIME_PASSWORD_HASH;
  const missingFailure = await captureFailure(missing);
  assert.match(missingFailure.stderr, /NATS_RUNTIME_PASSWORD_HASH is required/u);
  assertDoesNotExposeCredentials(missingFailure.stderr, missing);

  const malformed = validEnvironment();
  malformed.NATS_REALTIME_CONSUMER_PASSWORD_HASH =
    "$2a$03$not-a-production-bcrypt-verifier";
  const malformedFailure = await captureFailure(malformed);
  assert.match(
    malformedFailure.stderr,
    /must be a canonical NATS bcrypt 2a cost-11 verifier/u
  );
  assertDoesNotExposeCredentials(malformedFailure.stderr, malformed);

  const unsafeCost = validEnvironment();
  unsafeCost.NATS_REALTIME_CONSUMER_PASSWORD_HASH =
    "$2a$10$biu94pm9wRs6z9rIuer3letiCffv/X59tkqkxr7oWhaiUMdKsV/DK";
  const unsafeCostFailure = await captureFailure(unsafeCost);
  assert.match(
    unsafeCostFailure.stderr,
    /must be a canonical NATS bcrypt 2a cost-11 verifier/u
  );
  assertDoesNotExposeCredentials(unsafeCostFailure.stderr, unsafeCost);

  const incompatibleVariant = validEnvironment();
  incompatibleVariant.NATS_REALTIME_CONSUMER_PASSWORD_HASH =
    "$2b$11$biu94pm9wRs6z9rIuer3letiCffv/X59tkqkxr7oWhaiUMdKsV/DK";
  const incompatibleVariantFailure = await captureFailure(
    incompatibleVariant
  );
  assert.match(
    incompatibleVariantFailure.stderr,
    /must be a canonical NATS bcrypt 2a cost-11 verifier/u
  );
  assertDoesNotExposeCredentials(
    incompatibleVariantFailure.stderr,
    incompatibleVariant
  );

  const reused = validEnvironment();
  reused.NATS_PROVISIONER_PASSWORD_HASH = reused.NATS_RUNTIME_PASSWORD_HASH;
  const reusedFailure = await captureFailure(reused);
  assert.match(
    reusedFailure.stderr,
    /NATS_PROVISIONER_PASSWORD_HASH must differ from NATS_RUNTIME_PASSWORD_HASH/u
  );
  assertDoesNotExposeCredentials(reusedFailure.stderr, reused);
});

test("preflight rejects placeholders, unsafe characters and invalid length", async () => {
  const cases = [
    {
      name: "PLATFORM_API_TO_SEO_DATA_TOKEN",
      value: "replace-me-distinct-random-platform-api-token",
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
    },
    {
      name: "NATS_PROVISIONER_PASSWORD",
      value: `9${"s".repeat(39)}`,
      expected: /must start with an ASCII letter/u
    },
    {
      name: "NATS_REALTIME_CONSUMER_PASSWORD",
      value: `${"s".repeat(40)}\n`,
      expected: /must be URL-safe/u
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
  return {
    ...Object.fromEntries(
    credentialNames.map((name, index) => [
      name,
      `generated-${index}-${"x".repeat(48)}`
    ])
    ),
    ...Object.fromEntries(
      usernameNames.map((name, index) => [name, `nats_identity_${index}`])
    ),
    ...Object.fromEntries(
      natsPasswordHashNames.map((name, index) => [name, natsPasswordHashes[index]])
    ),
    ...Object.fromEntries(
      smtpCredentialNames.map((name, index) => [
        name,
        `smtp-identity-${index}-${"z".repeat(24)}`
      ])
    )
  };
}

function assertDoesNotExposeCredentials(output, environment) {
  for (const value of Object.values(environment)) {
    if (value === "") continue;
    assert.equal(
      output.includes(value),
      false,
      "preflight output must not contain credential material"
    );
  }
}
