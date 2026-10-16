import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type HostResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;

const blockedIpv4Addresses = new BlockList();
blockedIpv4Addresses.addAddress("168.63.129.16", "ipv4");

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

const ipv4Groups = (address: string): [number, number] => {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    throw new Error(`Invalid embedded IPv4 address: ${address}`);
  }
  return [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
};

const ipv6Value = (address: string): bigint => {
  const [head = "", tail, extra] = address.toLowerCase().split("::");
  if (extra !== undefined) throw new Error(`Invalid IPv6 address: ${address}`);
  const parseGroups = (side: string): Array<number> =>
    side === ""
      ? []
      : side
          .split(":")
          .flatMap((group) =>
            group.includes(".") ? ipv4Groups(group) : [Number.parseInt(group, 16)],
          );
  const left = parseGroups(head);
  const right = parseGroups(tail ?? "");
  if (left.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    throw new Error(`Invalid IPv6 address: ${address}`);
  }
  const missing = 8 - left.length - right.length;
  if ((tail === undefined && missing !== 0) || missing < 0) {
    throw new Error(`Invalid IPv6 address: ${address}`);
  }
  return [...left, ...Array<number>(missing).fill(0), ...right].reduce(
    (value, group) => (value << 16n) | BigInt(group),
    0n,
  );
};

const blockedIpv6Ranges = [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["::ffff:0:0", 96],
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const;

const isBlockedIpv6 = (address: string): boolean => {
  try {
    const value = ipv6Value(address);
    return blockedIpv6Ranges.some(([network, prefix]) => {
      const shift = BigInt(128 - prefix);
      return value >> shift === ipv6Value(network) >> shift;
    });
  } catch {
    return true;
  }
};

export const networkHostname = (hostname: string): string =>
  hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

export const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return blockedIpv4Addresses.check(address, "ipv4");
  if (family === 6) return isBlockedIpv6(address);
  return true;
};

export const resolveHostname: HostResolver = async (hostname) => {
  const normalized = networkHostname(hostname);
  const literalFamily = isIP(normalized);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: normalized, family: literalFamily }];
  }
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  return addresses.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
};

/** Resolve every DNS answer before connecting. A host is rejected if any answer is private. */
export const resolveTargetUrl = async (
  url: URL,
  allowPrivate: boolean,
  resolve: HostResolver = resolveHostname,
): Promise<ReadonlyArray<ResolvedAddress>> => {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("Target URLs must not contain credentials");
  const hostname = networkHostname(url.hostname).toLowerCase();
  if (!allowPrivate && (hostname === "localhost" || hostname.endsWith(".local"))) {
    throw new Error(`Private target is not allowed: ${hostname}`);
  }
  const addresses = await resolve(hostname);
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => isIP(address) !== family) ||
    (!allowPrivate && addresses.some(({ address }) => isPrivateAddress(address)))
  ) {
    throw new Error(`Private target is not allowed: ${hostname}`);
  }
  return addresses;
};

/** A lookup callback pinned to the already validated DNS answers. */
export const pinnedLookup = (addresses: ReadonlyArray<ResolvedAddress>): LookupFunction => {
  const [first] = addresses;
  if (first === undefined) throw new Error("Cannot create a pinned lookup without an address");
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(
        null,
        addresses.map(({ address, family }) => ({ address, family })),
      );
      return;
    }
    callback(null, first.address, first.family);
  };
};
