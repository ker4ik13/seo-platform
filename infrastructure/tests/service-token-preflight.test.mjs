import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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
  "REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN",
  "JOBS_TO_SEO_RANK_TOKEN",
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
  "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN",
  "JOBS_TO_PLATFORM_AUTOMATION_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN",
  "RANK_HISTORY_CURSOR_KEY",
  "OPERATIONAL_ALERT_TOKEN",
  "REDIS_JOBS_API_PASSWORD",
  "REDIS_JOBS_SYSTEM_PASSWORD",
  "REDIS_JOBS_INSPECTION_PASSWORD",
  "REDIS_JOBS_IMPORT_PASSWORD",
  "REDIS_JOBS_RANK_PASSWORD",
  "REDIS_JOBS_CRAWL_PASSWORD",
  "REDIS_JOBS_CONNECTOR_PASSWORD",
  "REDIS_REALTIME_PASSWORD",
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
  "AUTH_EMAIL_SMTP_PASSWORD"
];

test("preflight script is valid POSIX shell and accepts distinct credentials", async () => {
  await execute("/bin/sh", ["-n", scriptPath]);
  const environment = validEnvironment();
  const result = await runPreflight(environment);

  assert.match(
    result.stdout,
    /validated 28 distinct deploy credentials, 5 distinct NATS bcrypt verifiers, 5 distinct NATS usernames and 0 enabled platform providers/u
  );
  assert.equal(result.stderr, "");
  assertDoesNotExposeCredentials(
    `${result.stdout}${result.stderr}`,
    environment
  );
});

test("preflight accepts complete enabled platform providers", async () => {
  const environment = validEnvironment();
  Object.assign(environment, {
    PLATFORM_XMLSTOCK_ENABLED: "true",
    PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "17",
    PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR: "1000",
    PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR: "10000",
    PLATFORM_XMLSTOCK_API_KEYS: "xmlstock-provider-secret-1,xmlstock-provider-secret-2",
    PLATFORM_XMLSTOCK_ACCOUNT_IDS: "xmlstock-account-1,xmlstock-account-2",
    PLATFORM_ARSENKIN_ENABLED: "true",
    PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "29",
    PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "2000",
    PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "20000",
    PLATFORM_ARSENKIN_API_KEYS: "arsenkin-provider-secret-1,arsenkin-provider-secret-2"
  });

  const result = await runPreflight(environment);

  assert.match(result.stdout, /2 enabled platform providers/u);
  assert.equal(result.stderr, "");
  assertDoesNotExposeCredentials(
    `${result.stdout}${result.stderr}`,
    environment
  );
});

test("preflight keeps provider bounds portable below POSIX RE_DUP_MAX", async () => {
  const source = await readFile(scriptPath, "utf8");
  const grepExpressions = source
    .split("\n")
    .filter((line) => line.includes("grep -E"))
    .join("\n");
  const intervalBounds = [
    ...grepExpressions.matchAll(/\{\d+,(\d+)\}/gu)
  ].map((match) => Number(match[1]));
  assert.equal(
    intervalBounds.every((upperBound) => upperBound <= 255),
    true,
    "grep interval expressions must not exceed POSIX RE_DUP_MAX"
  );

  const environment = validEnvironment();
  Object.assign(environment, {
    PLATFORM_XMLSTOCK_ENABLED: "true",
    PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "17",
    PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR: "1000",
    PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR: "10000",
    PLATFORM_XMLSTOCK_API_KEYS: "x".repeat(2048),
    PLATFORM_XMLSTOCK_ACCOUNT_IDS: "a".repeat(255)
  });

  const result = await runPreflight(environment);

  assert.equal(result.stderr, "");
  assertDoesNotExposeCredentials(result.stdout, environment);
});

test("preflight fails closed for incomplete or malformed platform configuration", async () => {
  const cases = [
    {
      patch: { PLATFORM_XMLSTOCK_ENABLED: "yes" },
      expected: /PLATFORM_XMLSTOCK_ENABLED must be true or false/u
    },
    {
      patch: {
        PLATFORM_XMLSTOCK_ENABLED: "true",
        PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "0",
        PLATFORM_XMLSTOCK_API_KEY: "xmlstock-provider-secret",
        PLATFORM_XMLSTOCK_ACCOUNT_ID: "xmlstock-account"
      },
      expected: /PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR must be a positive safe integer/u
    },
    {
      patch: {
        PLATFORM_XMLSTOCK_ENABLED: "true",
        PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "61489146913",
        PLATFORM_XMLSTOCK_API_KEY: "xmlstock-provider-secret",
        PLATFORM_XMLSTOCK_ACCOUNT_ID: "xmlstock-account"
      },
      expected: /no greater than 61489146912/u
    },
    {
      patch: {
        PLATFORM_XMLSTOCK_ENABLED: "true",
        PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "17",
        PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR: "1000",
        PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR: "10000",
        PLATFORM_XMLSTOCK_API_KEY: "xmlstock-provider-secret"
      },
      expected: /PLATFORM_XMLSTOCK_ACCOUNT_IDS is required/u
    },
    {
      patch: {
        PLATFORM_XMLSTOCK_ENABLED: "true",
        PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "17",
        PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR: "1000",
        PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR: "10000",
        PLATFORM_XMLSTOCK_API_KEYS: "xmlstock-provider-secret-1,xmlstock-provider-secret-2",
        PLATFORM_XMLSTOCK_ACCOUNT_IDS: "xmlstock-account"
      },
      expected: /exactly one identifier per API key in the same order/u
    },
    {
      patch: {
        PLATFORM_XMLSTOCK_ENABLED: "true",
        PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "17",
        PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR: "1000",
        PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR: "10000",
        PLATFORM_XMLSTOCK_API_KEYS: "xmlstock-provider-secret-1,xmlstock-provider-secret-2",
        PLATFORM_XMLSTOCK_ACCOUNT_IDS: "xmlstock-account,xmlstock-account"
      },
      expected: /must not contain duplicate identifiers/u
    },
    {
      patch: {
        PLATFORM_ARSENKIN_ENABLED: "true",
        PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "29",
        PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "2000",
        PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "20000",
        PLATFORM_ARSENKIN_API_KEY: "has whitespace"
      },
      expected: /PLATFORM_ARSENKIN_API_KEY items must contain/u
    },
    {
      patch: {
        PLATFORM_ARSENKIN_ENABLED: "true",
        PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "29",
        PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "2000",
        PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "20000",
        PLATFORM_ARSENKIN_API_KEYS: "duplicate-key,duplicate-key"
      },
      expected: /platform provider API keys must be distinct/u
    },
    {
      patch: {
        PLATFORM_ARSENKIN_ENABLED: "true",
        PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "29",
        PLATFORM_ARSENKIN_API_KEY: "arsenkin-provider-secret"
      },
      expected: /PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR is required/u
    },
    {
      patch: {
        PLATFORM_ARSENKIN_ENABLED: "true",
        PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "29",
        PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "2000",
        PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "1999",
        PLATFORM_ARSENKIN_API_KEY: "arsenkin-provider-secret"
      },
      expected: /MONTHLY_SPEND_LIMIT_MINOR must be greater than or equal/u
    }
  ];

  for (const invalidCase of cases) {
    const environment = { ...validEnvironment(), ...invalidCase.patch };
    const failure = await captureFailure(environment);
    assert.match(failure.stderr, invalidCase.expected);
    assertDoesNotExposeCredentials(failure.stderr, environment);
  }
});

test("preflight rejects provider key reuse without logging the secret", async () => {
  const environment = validEnvironment();
  Object.assign(environment, {
    PLATFORM_ARSENKIN_ENABLED: "true",
    PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "29",
    PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "2000",
    PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "20000",
    PLATFORM_ARSENKIN_API_KEY: environment.OPERATIONAL_ALERT_TOKEN
  });

  const failure = await captureFailure(environment);

  assert.match(
    failure.stderr,
    /PLATFORM_ARSENKIN_API_KEY must differ from OPERATIONAL_ALERT_TOKEN/u
  );
  assertDoesNotExposeCredentials(failure.stderr, environment);
});

test("preflight accepts generated URL-safe credentials containing hyphens", async () => {
  const environment = validEnvironment();
  environment.NATS_RUNTIME_PASSWORD =
    "generated-runtime-password-with-many-hyphens-123456";

  const result = await runPreflight(environment);

  assert.equal(result.stderr, "");
  assertDoesNotExposeCredentials(result.stdout, environment);
});

test("preflight canonicalizes Dokploy double-dollar bcrypt transport values", async () => {
  const environment = validEnvironment();
  for (const hashName of natsPasswordHashNames) {
    environment[hashName] = environment[hashName].split("$").join("$$");
  }

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

test("preflight requires isolated auth-email SMTP credentials", async () => {
  const missing = validEnvironment();
  delete missing.AUTH_EMAIL_SMTP_PASSWORD;
  const missingFailure = await captureFailure(missing);
  assert.match(
    missingFailure.stderr,
    /AUTH_EMAIL_SMTP_PASSWORD is required/u
  );
  assertDoesNotExposeCredentials(missingFailure.stderr, missing);

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
  reused.NATS_PROVISIONER_PASSWORD_HASH =
    reused.NATS_RUNTIME_PASSWORD_HASH.split("$").join("$$");
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
    ),
    PLATFORM_XMLSTOCK_ENABLED: "false",
    PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "",
    PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR: "",
    PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR: "",
    PLATFORM_XMLSTOCK_API_KEYS: "",
    PLATFORM_XMLSTOCK_ACCOUNT_IDS: "",
    PLATFORM_XMLSTOCK_API_KEY: "",
    PLATFORM_XMLSTOCK_ACCOUNT_ID: "",
    PLATFORM_ARSENKIN_ENABLED: "false",
    PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "",
    PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "",
    PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "",
    PLATFORM_ARSENKIN_API_KEYS: "",
    PLATFORM_ARSENKIN_API_KEY: ""
  };
}

function assertDoesNotExposeCredentials(output, environment) {
  for (const value of Object.values(environment)) {
    if (value.length < 8) continue;
    assert.equal(
      output.includes(value),
      false,
      "preflight output must not contain credential material"
    );
  }
}
