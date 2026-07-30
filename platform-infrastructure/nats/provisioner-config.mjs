import { NatsTopologyError, buildNatsTopology } from "./topology.mjs";

const usernamePattern = /^[A-Za-z][A-Za-z0-9_-]{2,63}$/u;
const passwordPattern = /^[A-Za-z][-A-Za-z0-9._~]{31,511}$/u;
const placeholderPattern =
  /^(?:example|replace-|change-me|changeme|your[-_])/iu;

export function loadProvisionerConfiguration(environment) {
  const url = required(environment, "NATS_URL");
  const user = required(environment, "NATS_USER");
  const password = required(environment, "NATS_PASSWORD");
  const eventEnvironment = required(
    environment,
    "NATS_EVENT_ENVIRONMENT"
  );

  if (!usernamePattern.test(user) || placeholderPattern.test(user)) {
    throw configurationError("NATS_USER");
  }
  if (
    !passwordPattern.test(password) ||
    placeholderPattern.test(password) ||
    password === user
  ) {
    throw configurationError("NATS_PASSWORD");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw configurationError("NATS_URL");
  }
  if (
    parsedUrl.protocol !== "nats:" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    (parsedUrl.pathname !== "" && parsedUrl.pathname !== "/") ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== ""
  ) {
    throw configurationError("NATS_URL");
  }

  buildNatsTopology(eventEnvironment);

  return Object.freeze({
    url,
    user,
    password,
    environment: eventEnvironment
  });
}

function required(environment, name) {
  const value = environment[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    placeholderPattern.test(value)
  ) {
    throw configurationError(name);
  }
  return value;
}

function configurationError(name) {
  return new NatsTopologyError("INVALID_CONFIGURATION", name);
}
