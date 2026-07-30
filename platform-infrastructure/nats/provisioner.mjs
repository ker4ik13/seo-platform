import { jetstreamManager } from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";
import {
  provisionNatsTopology,
  safeProvisionerFailure
} from "./topology.mjs";
import { loadProvisionerConfiguration } from "./provisioner-config.mjs";

const connectionName = "nats-topology-provisioner";

let connection;
let exitCode = 0;

try {
  const configuration = loadProvisionerConfiguration(process.env);
  connection = await connect({
    servers: configuration.url,
    user: configuration.user,
    pass: configuration.password,
    name: connectionName,
    timeout: 5_000,
    maxReconnectAttempts: 0
  });
  const manager = await jetstreamManager(connection, { timeout: 10_000 });
  const result = await provisionNatsTopology({
    manager,
    environment: configuration.environment
  });
  process.stdout.write(
    `nats-topology-provisioner: source=${result.sourceStream} dlq=${result.dlqStream} consumer=${result.consumer}\n`
  );
} catch (error) {
  exitCode = 1;
  process.stderr.write(`${safeProvisionerFailure(error)}\n`);
} finally {
  if (connection) {
    try {
      await connection.drain();
    } catch {
      exitCode = 1;
      process.stderr.write(
        "nats-topology-provisioner: CONNECTION_DRAIN_FAILED (nats)\n"
      );
    }
  }
}

process.exitCode = exitCode;
