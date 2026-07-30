import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rendererPath = fileURLToPath(
  new URL("../nats/start-nats.sh", import.meta.url)
);
const templatePath = fileURLToPath(
  new URL("../nats/nats-server.conf", import.meta.url)
);

const credentialNames = [
  "NATS_RUNTIME_USER",
  "NATS_RUNTIME_PASSWORD_HASH",
  "NATS_PLATFORM_PUBLISHER_USER",
  "NATS_PLATFORM_PUBLISHER_PASSWORD_HASH",
  "NATS_REALTIME_CONSUMER_USER",
  "NATS_REALTIME_CONSUMER_PASSWORD_HASH",
  "NATS_AUTH_EMAIL_CONSUMER_USER",
  "NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH",
  "NATS_PROVISIONER_USER",
  "NATS_PROVISIONER_PASSWORD_HASH",
  "NATS_IDENTITY_EVENT_SUBJECT",
  "NATS_IDENTITY_EVENT_DLQ_SUBJECT",
  "NATS_EMAIL_VERIFICATION_EVENT_SUBJECT",
  "NATS_PASSWORD_RESET_EVENT_SUBJECT",
  "NATS_WORKSPACE_INVITE_EVENT_SUBJECT",
  "NATS_AUTH_EMAIL_DLQ_SUBJECT"
];

test("renderer writes a marker-free mode-600 config and scrubs exec env", async (t) => {
  const fixture = await runRenderer(t);

  assert.equal(fixture.result.code, 0, fixture.result.stderr);
  assert.equal(fixture.result.stdout, "");
  assert.equal(fixture.result.stderr, "");

  const rendered = await readFile(fixture.runtimeConfig, "utf8");
  assert.doesNotMatch(rendered, /__NATS_[A-Z0-9_]+__/u);
  for (const hashName of passwordHashNames()) {
    assert.match(
      rendered,
      new RegExp(
        `password:\\s*"${escapeRegularExpression(fixture.environment[hashName])}"`,
        "u"
      )
    );
  }
  assert.equal((await stat(fixture.runtimeConfig)).mode & 0o777, 0o600);

  const executedEnvironment = await readFile(fixture.execEnvironment, "utf8");
  for (const name of credentialNames) {
    assert.doesNotMatch(executedEnvironment, new RegExp(`^${name}=`, "mu"));
  }
  assert.deepEqual(
    (await readFile(fixture.execArguments, "utf8")).trim().split("\n"),
    ["--config", fixture.runtimeConfig]
  );
});

test("renderer rejects missing malformed duplicate or cross-environment input without leakage", async (t) => {
  const cases = [
    {
      name: "missing verifier",
      mutate(environment) {
        delete environment.NATS_RUNTIME_PASSWORD_HASH;
      },
      error: /NATS_RUNTIME_PASSWORD_HASH is required/u
    },
    {
      name: "noncanonical bcrypt variant",
      mutate(environment) {
        environment.NATS_REALTIME_CONSUMER_PASSWORD_HASH =
          environment.NATS_REALTIME_CONSUMER_PASSWORD_HASH.replace(
            /^\$2a\$/u,
            "$2b$"
          );
      },
      error: /canonical NATS bcrypt 2a cost-11 verifier/u
    },
    {
      name: "malformed username",
      mutate(environment) {
        environment.NATS_PROVISIONER_USER = "invalid user";
      },
      error: /NATS_PROVISIONER_USER must be a canonical NATS username/u
    },
    {
      name: "duplicate usernames",
      mutate(environment) {
        environment.NATS_PROVISIONER_USER = environment.NATS_RUNTIME_USER;
      },
      error: /NATS_PROVISIONER_USER must differ from NATS_RUNTIME_USER/u
    },
    {
      name: "duplicate verifiers",
      mutate(environment) {
        environment.NATS_PROVISIONER_PASSWORD_HASH =
          environment.NATS_RUNTIME_PASSWORD_HASH;
      },
      error: /NATS_PROVISIONER_PASSWORD_HASH must differ from NATS_RUNTIME_PASSWORD_HASH/u
    },
    {
      name: "mismatched subject environments",
      mutate(environment) {
        environment.NATS_IDENTITY_EVENT_DLQ_SUBJECT =
          "other.dlq.realtime.identity.session-family.revoked.v1";
      },
      error: /subjects must use the same environment/u
    }
  ];

  for (const currentCase of cases) {
    await t.test(currentCase.name, async (subtest) => {
      const environment = validEnvironment();
      currentCase.mutate(environment);
      const fixture = await runRenderer(subtest, { environment });

      assert.notEqual(fixture.result.code, 0);
      assert.match(fixture.result.stderr, currentCase.error);
      assert.equal(fixture.result.stdout, "");
      assertDoesNotLeak(fixture.result, environment);
      await assert.rejects(readFile(fixture.runtimeConfig), { code: "ENOENT" });
    });
  }
});

test("renderer fails closed when a required template marker is missing or duplicated", async (t) => {
  for (const [name, transform] of [
    [
      "missing marker",
      (template) => template.replace("__NATS_RUNTIME_USER__", "runtime_user")
    ],
    [
      "duplicate marker",
      (template) => `${template}\n# __NATS_RUNTIME_USER__\n`
    ]
  ]) {
    await t.test(name, async (subtest) => {
      const fixture = await runRenderer(subtest, {
        transformTemplate: transform
      });

      assert.notEqual(fixture.result.code, 0);
      assert.match(
        fixture.result.stderr,
        /template marker NATS_RUNTIME_USER must occur exactly once/u
      );
      assertDoesNotLeak(fixture.result, fixture.environment);
      await assert.rejects(readFile(fixture.runtimeConfig), { code: "ENOENT" });
    });
  }
});

async function runRenderer(
  t,
  { environment = validEnvironment(), transformTemplate } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "seo-nats-renderer-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDirectory = join(root, "bin");
  const runtimeDirectory = join(root, "runtime");
  const localTemplate = join(root, "nats-server.conf");
  const execEnvironment = join(root, "exec.env");
  const execArguments = join(root, "exec.args");
  const stub = join(binDirectory, "nats-server");

  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(binDirectory, { recursive: true })
  );
  await copyFile(templatePath, localTemplate);
  if (transformTemplate) {
    const original = await readFile(localTemplate, "utf8");
    await writeFile(localTemplate, transformTemplate(original), "utf8");
  }
  await writeFile(
    stub,
    [
      "#!/bin/sh",
      "set -eu",
      'env > "$NATS_TEST_EXEC_ENV"',
      'printf \'%s\\n\' "$@" > "$NATS_TEST_EXEC_ARGS"'
    ].join("\n"),
    { mode: 0o700 }
  );
  await chmod(stub, 0o700);

  const result = await spawnResult("/bin/sh", [
    rendererPath,
    localTemplate,
    runtimeDirectory
  ], {
    ...environment,
    PATH: `${binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    NATS_TEST_EXEC_ENV: execEnvironment,
    NATS_TEST_EXEC_ARGS: execArguments
  });

  return {
    environment,
    result,
    runtimeConfig: join(runtimeDirectory, "nats-server.conf"),
    execEnvironment,
    execArguments
  };
}

function validEnvironment() {
  return {
    NATS_RUNTIME_USER: "preview_runtime",
    NATS_RUNTIME_PASSWORD_HASH:
      "$2a$11$SnmJ/ftus.QHSRgvQK4xkucVtf5ucK25GsOSsjVPJem9i2U5txZFK",
    NATS_PLATFORM_PUBLISHER_USER: "preview_platform_publisher",
    NATS_PLATFORM_PUBLISHER_PASSWORD_HASH:
      "$2a$11$PDhMidnaWsRKmptE4e0hEeNHwtbSknwwAJMGSY4YxwW2gu03q.Ena",
    NATS_REALTIME_CONSUMER_USER: "preview_realtime_consumer",
    NATS_REALTIME_CONSUMER_PASSWORD_HASH:
      "$2a$11$biu94pm9wRs6z9rIuer3letiCffv/X59tkqkxr7oWhaiUMdKsV/DK",
    NATS_AUTH_EMAIL_CONSUMER_USER: "preview_auth_email_consumer",
    NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH:
      "$2a$11$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    NATS_PROVISIONER_USER: "preview_topology_provisioner",
    NATS_PROVISIONER_PASSWORD_HASH:
      "$2a$11$YSHwX16VLEEE/MFWc6s9auKSXYjddbpGTVlOuZpWZvuoIIYZ6aYP.",
    NATS_IDENTITY_EVENT_SUBJECT:
      "preview.identity.session-family.revoked.v1",
    NATS_IDENTITY_EVENT_DLQ_SUBJECT:
      "preview.dlq.realtime.identity.session-family.revoked.v1",
    NATS_EMAIL_VERIFICATION_EVENT_SUBJECT:
      "preview.email.identity.email-verification.requested.v1",
    NATS_PASSWORD_RESET_EVENT_SUBJECT:
      "preview.email.identity.password-reset.requested.v1",
    NATS_WORKSPACE_INVITE_EVENT_SUBJECT:
      "preview.email.workspace.invite.requested.v1",
    NATS_AUTH_EMAIL_DLQ_SUBJECT:
      "preview.dlq.jobs.transactional-email.v1"
  };
}

function passwordHashNames() {
  return credentialNames.filter((name) => name.endsWith("_PASSWORD_HASH"));
}

function assertDoesNotLeak(result, environment) {
  const output = `${result.stdout}\n${result.stderr}`;
  for (const value of Object.values(environment)) {
    assert.equal(output.includes(value), false);
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function spawnResult(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
