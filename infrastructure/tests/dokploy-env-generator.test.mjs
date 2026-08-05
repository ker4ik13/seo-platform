import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testDirectory, "../..");
const generator = join(projectRoot, "infrastructure/generate-dokploy-env.sh");
const preflight = join(
  projectRoot,
  "infrastructure/security/validate-service-tokens.sh"
);

const bcryptAvailable = spawnSync(
  "python3",
  ["-c", "import bcrypt"],
  { encoding: "utf8" }
).status === 0;

const randomSecretNames = [
  "POSTGRES_PASSWORD",
  "PLATFORM_DATABASE_OWNER_PASSWORD",
  "PLATFORM_DATABASE_PASSWORD",
  "SEO_DATABASE_OWNER_PASSWORD",
  "SEO_DATABASE_PASSWORD",
  "JOBS_DATABASE_OWNER_PASSWORD",
  "JOBS_DATABASE_PASSWORD",
  "JOBS_RANK_DATABASE_PASSWORD",
  "JOBS_AUTH_EMAIL_DATABASE_PASSWORD",
  "JOBS_CONNECTOR_DATABASE_PASSWORD",
  "REALTIME_DATABASE_OWNER_PASSWORD",
  "REALTIME_DATABASE_PASSWORD",
  "REALTIME_WEB_PUSH_DATABASE_PASSWORD",
  "REDIS_JOBS_API_PASSWORD",
  "REDIS_JOBS_SYSTEM_PASSWORD",
  "REDIS_JOBS_INSPECTION_PASSWORD",
  "REDIS_JOBS_IMPORT_PASSWORD",
  "REDIS_JOBS_RANK_PASSWORD",
  "REDIS_JOBS_CRAWL_PASSWORD",
  "REDIS_JOBS_CONNECTOR_PASSWORD",
  "REDIS_REALTIME_PASSWORD",
  "PLATFORM_API_TO_SEO_DATA_TOKEN",
  "PLATFORM_API_TO_JOBS_TOKEN",
  "JOBS_TO_SEO_DATA_TOKEN",
  "PLATFORM_API_TO_REALTIME_TOKEN",
  "JOBS_TO_SEO_RANK_TOKEN",
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
  "JOBS_TO_PLATFORM_AUTOMATION_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN",
  "RANK_HISTORY_CURSOR_KEY",
  "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
  "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN",
  "REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN",
  "AUTH_PASSWORD_PEPPER"
];

const natsRoles = [
  "RUNTIME",
  "PLATFORM_PUBLISHER",
  "REALTIME_CONSUMER",
  "AUTH_EMAIL_CONSUMER",
  "PROVISIONER"
];

const manuallyFilledNames = [
  "WEB_PUBLIC_URL",
  "API_PUBLIC_URL",
  "YOOKASSA_SHOP_ID",
  "YOOKASSA_SECRET_KEY",
  "YOOKASSA_RETURN_URL",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET_UPLOADS",
  "S3_BUCKET_ARTIFACTS",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_MESSAGE_ID_DOMAIN",
  "AUTH_EMAIL_SMTP_HOST",
  "AUTH_EMAIL_SMTP_USER",
  "AUTH_EMAIL_SMTP_PASSWORD",
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_VAPID_SUBJECT",
  "WEB_PUSH_VAPID_KEY_VERSION",
  "WEB_PUSH_SUBSCRIPTION_KEYS",
  "WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION",
  "WEB_PUSH_FINGERPRINT_KEYS",
  "WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION"
];

function parseEnvironment(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/u)) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    assert.notEqual(separator, -1, `invalid dotenv line: ${line}`);
    const name = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (
      value.length >= 2 &&
      ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"')))
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }
  return values;
}

test(
  "Dokploy environment generator creates matching unique secrets without overwriting",
  { skip: !bcryptAvailable },
  async (context) => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "seo-platform-dokploy-env-")
    );
    context.after(async () => {
      await rm(temporaryDirectory, { recursive: true, force: true });
    });

    const output = join(temporaryDirectory, ".env.dokploy.generated");
    const generation = spawnSync("bash", [generator, output], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert.equal(generation.status, 0, generation.stderr);

    const metadata = await stat(output);
    assert.equal(metadata.mode & 0o777, 0o600);

    const source = await readFile(output, "utf8");
    const environment = parseEnvironment(source);
    const templateEnvironment = parseEnvironment(
      await readFile(join(projectRoot, ".env.example"), "utf8")
    );
    assert.equal(environment.size, 210);
    assert.deepEqual(
      [...environment.keys()].sort(),
      [...templateEnvironment.keys()].sort(),
      "generated environment must retain every canonical variable line"
    );
    const randomValues = randomSecretNames.map((name) => {
      const value = environment.get(name);
      assert.match(value ?? "", /^[a-f0-9]{64}$/u, name);
      return value;
    });

    for (const role of natsRoles) {
      const passwordName = `NATS_${role}_PASSWORD`;
      const hashName = `NATS_${role}_PASSWORD_HASH`;
      const password = environment.get(passwordName);
      const dokployHash = environment.get(hashName);
      assert.match(password ?? "", /^n[a-f0-9]{64}$/u, passwordName);
      assert.match(
        dokployHash ?? "",
        /^\$\$2a\$\$11\$\$[./A-Za-z0-9]{53}$/u,
        `${hashName} must survive Dokploy's dotenv rewrite`
      );
      const hash = dokployHash?.replaceAll("$$", "$");
      assert.match(hash ?? "", /^\$2a\$11\$[./A-Za-z0-9]{53}$/u, hashName);
      randomValues.push(password);

      const verification = spawnSync(
        "python3",
        [
          "-c",
          "import bcrypt,sys; password, verifier = sys.stdin.buffer.read().split(b'\\0', 1); raise SystemExit(0 if bcrypt.checkpw(password, verifier) else 1)"
        ],
        { input: `${password}\0${hash}`, encoding: "utf8" }
      );
      assert.equal(verification.status, 0, `${hashName} does not match`);
    }

    assert.equal(new Set(randomValues).size, randomValues.length);
    assert.match(
      environment.get("AUTH_DATA_ENCRYPTION_KEY") ?? "",
      /^[A-Za-z0-9_-]{43}$/u
    );
    assert.match(
      environment.get("INTEGRATION_CREDENTIAL_KEYS") ?? "",
      /^1:[A-Za-z0-9_-]{43}$/u
    );
    assert.match(
      environment.get("INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS") ?? "",
      /^1:[A-Za-z0-9_-]{43}$/u
    );
    for (const name of manuallyFilledNames) {
      assert.equal(environment.get(name), "", `${name} must remain manual`);
      assert.match(
        source,
        new RegExp(`# ВРУЧНУЮ[^\\n]*[\\s\\S]{0,240}\\n${name}=$`, "mu"),
        `${name} must have an adjacent manual instruction`
      );
    }

    const validation = spawnSync("sh", [preflight], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        ...Object.fromEntries(environment),
        ...Object.fromEntries(
          natsRoles.map((role) => {
            const name = `NATS_${role}_PASSWORD_HASH`;
            return [name, environment.get(name)?.replaceAll("$$", "$")];
          })
        ),
        AUTH_EMAIL_SMTP_USER: "generator-test-smtp-user",
        AUTH_EMAIL_SMTP_PASSWORD: "generator-test-smtp-password"
      }
    });
    assert.equal(validation.status, 0, validation.stderr);

    const originalSource = await readFile(output, "utf8");
    const secondGeneration = spawnSync("bash", [generator, output], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert.notEqual(secondGeneration.status, 0);
    assert.match(secondGeneration.stderr, /refusing to overwrite/u);
    assert.equal(await readFile(output, "utf8"), originalSource);
  }
);
