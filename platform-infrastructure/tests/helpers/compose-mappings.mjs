import assert from "node:assert/strict";

export function parseYamlMappings(source) {
  const root = createMapping();
  const document = { anchors: new Map(), root };
  const stack = [{ indent: -1, mapping: root }];

  for (const [lineIndex, rawLine] of source.split(/\r?\n/u).entries()) {
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) {
      continue;
    }
    assert.doesNotMatch(
      rawLine,
      /^\t+/u,
      `Compose line ${lineIndex + 1} must not use tab indentation`
    );
    const indent = rawLine.length - rawLine.trimStart().length;
    const content = rawLine.trim();

    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.mapping;
    assert.ok(parent, `invalid Compose indentation at line ${lineIndex + 1}`);

    const listEnvironment = /^-\s+([A-Z][A-Z0-9_]*)(?:=(.*))?$/u.exec(
      content
    );
    if (listEnvironment) {
      addEntry(
        parent,
        listEnvironment[1],
        listEnvironment[2] ?? "",
        lineIndex
      );
      continue;
    }
    if (content.startsWith("-") || content === "[" || content === "]") {
      continue;
    }

    const property = /^(<<|[A-Za-z0-9_.-]+):(?:\s*(.*))?$/u.exec(content);
    if (!property) continue;
    const [, key, rawValue = ""] = property;

    if (key === "<<") {
      const aliases = [...rawValue.matchAll(/\*([A-Za-z0-9_-]+)/gu)].map(
        (match) => match[1]
      );
      assert.ok(
        aliases.length > 0,
        `unsupported YAML merge at Compose line ${lineIndex + 1}`
      );
      parent.merges.push(...aliases);
      continue;
    }

    const anchor = /^&([A-Za-z0-9_-]+)\s*$/u.exec(rawValue)?.[1];
    if (rawValue === "" || anchor) {
      const child = createMapping();
      addEntry(parent, key, child, lineIndex);
      if (anchor) {
        assert.ok(
          !document.anchors.has(anchor),
          `duplicate YAML anchor ${anchor}`
        );
        document.anchors.set(anchor, child);
      }
      stack.push({ indent, mapping: child });
      continue;
    }

    addEntry(parent, key, rawValue, lineIndex);
  }

  return document;
}

export function resolveMapping(mapping, document, resolving = new Set()) {
  if (resolving.has(mapping)) {
    assert.fail("cyclic YAML merge is not supported");
  }
  resolving.add(mapping);
  const resolved = new Map();

  for (const alias of mapping.merges) {
    const inherited = document.anchors.get(alias);
    assert.ok(inherited, `unknown YAML anchor ${alias}`);
    for (const [key, value] of resolveMapping(
      inherited,
      document,
      resolving
    )) {
      if (!resolved.has(key)) resolved.set(key, value);
    }
  }
  for (const [key, value] of mapping.entries) resolved.set(key, value);

  resolving.delete(mapping);
  return resolved;
}

export function serviceNames(document) {
  return [...servicesMapping(document).keys()];
}

export function serviceMapping(document, serviceName) {
  const service = servicesMapping(document).get(serviceName);
  assert.ok(isMapping(service), `${serviceName} service must exist`);
  return service;
}

export function serviceEnvironment(document, serviceName, required = true) {
  const service = serviceMapping(document, serviceName);
  const environment = resolveMapping(service, document).get("environment");
  if (!isMapping(environment)) {
    if (!required) return undefined;
    assert.fail(`${serviceName} must have an environment mapping`);
  }
  return resolveMapping(environment, document);
}

export function isMapping(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.entries instanceof Map &&
    Array.isArray(value.merges)
  );
}

export function stripMatchingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function sorted(values) {
  return [...values].sort();
}

function servicesMapping(document) {
  const services = resolveMapping(document.root, document).get("services");
  assert.ok(isMapping(services), "Compose services mapping must exist");
  return resolveMapping(services, document);
}

function createMapping() {
  return { entries: new Map(), merges: [] };
}

function addEntry(mapping, key, value, lineIndex) {
  assert.ok(
    !mapping.entries.has(key),
    `duplicate YAML key ${key} at Compose line ${lineIndex + 1}`
  );
  mapping.entries.set(key, value);
}
