import { isIP } from "node:net";

const IPV4_NETWORKS = [
  ["185.71.76.0", 27],
  ["185.71.77.0", 27],
  ["77.75.153.0", 25],
  ["77.75.156.11", 32],
  ["77.75.156.35", 32],
  ["77.75.154.128", 25]
] as const;
const IPV6_NETWORKS = [["2a02:5180::", 32]] as const;

export function isYookassaWebhookIp(value: string): boolean {
  const address = normalizeMappedIpv4(value.trim());
  const version = isIP(address);
  if (version === 4) {
    const candidate = ipv4Number(address);
    return IPV4_NETWORKS.some(([network, bits]) => {
      const shift = 32 - bits;
      return (
        (candidate >> BigInt(shift)) ===
        (ipv4Number(network) >> BigInt(shift))
      );
    });
  }
  if (version === 6) {
    const candidate = ipv6Number(address);
    return IPV6_NETWORKS.some(([network, bits]) => {
      const shift = 128 - bits;
      return (
        (candidate >> BigInt(shift)) ===
        (ipv6Number(network) >> BigInt(shift))
      );
    });
  }
  return false;
}

function normalizeMappedIpv4(value: string): string {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(value);
  return match?.[1] ?? value;
}

function ipv4Number(value: string): bigint {
  return value.split(".").reduce((result, octet) => {
    const numeric = Number(octet);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) {
      throw new Error("Invalid IPv4 address");
    }
    return (result << 8n) | BigInt(numeric);
  }, 0n);
}

function ipv6Number(value: string): bigint {
  const [head, tail, extra] = value.toLowerCase().split("::");
  if (extra !== undefined) throw new Error("Invalid IPv6 address");
  const headParts = hextets(head ?? "");
  const tailParts = tail === undefined ? [] : hextets(tail);
  const missing =
    tail === undefined ? 0 : 8 - headParts.length - tailParts.length;
  if (
    missing < 0 ||
    (tail === undefined && headParts.length !== 8) ||
    (tail !== undefined && missing < 1)
  ) {
    throw new Error("Invalid IPv6 address");
  }
  const parts = [
    ...headParts,
    ...Array.from({ length: missing }, () => 0),
    ...tailParts
  ];
  return parts.reduce(
    (result, part) => (result << 16n) | BigInt(part),
    0n
  );
}

function hextets(value: string): number[] {
  if (value === "") return [];
  return value.split(":").map((part) => {
    if (!/^[0-9a-f]{1,4}$/u.test(part)) {
      throw new Error("Invalid IPv6 address");
    }
    return Number.parseInt(part, 16);
  });
}
