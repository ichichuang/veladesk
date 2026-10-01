/**
 * Public/global IP address classification (task 020-A §7).
 *
 * Pure arithmetic — no DNS, no sockets — so the SSRF policy is fully unit
 * testable and injected DNS answers can be validated without a network.
 * Every address a recognition hostname resolves to must be public/global;
 * anything else (loopback, private, link-local, CGNAT, multicast,
 * reserved, documentation, IPv4-mapped/translated IPv6) is refused.
 */

export type AddressFamily = 4 | 6;

/** A parsed host address. */
export interface ParsedHostAddress {
  readonly family: AddressFamily;
  readonly address: string;
}

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Parses a dotted-quad IPv4 string into its numeric value; undefined when malformed. */
export function parseIpv4(address: string): bigint | undefined {
  if (!IPV4_PATTERN.test(address)) {
    return undefined;
  }
  let value = 0n;
  for (const octet of address.split(".")) {
    const octetValue = Number(octet);
    if (!Number.isInteger(octetValue) || octetValue < 0 || octetValue > 255) {
      return undefined;
    }
    value = (value << 8n) | BigInt(octetValue);
  }
  return value;
}

const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;

/**
 * Parses an IPv6 address (with `::` compression and optional embedded IPv4
 * tail) into its 128-bit value; undefined when malformed. The bracket-free
 * form is expected — URL hostnames carry brackets and unwrap them first.
 */
export function parseIpv6(address: string): bigint | undefined {
  const raw = address.toLowerCase();
  const compression = raw.indexOf("::");
  if (compression !== raw.lastIndexOf("::")) {
    return undefined; // at most one "::"
  }
  if (compression === -1) {
    const section = parseIpv6Section(raw, true);
    if (section === undefined || section.groups.length !== 8) {
      return undefined;
    }
    return assembleIpv6Groups(section.groups);
  }
  const head = parseIpv6Section(raw.slice(0, compression), false);
  const tail = parseIpv6Section(raw.slice(compression + 2), true);
  if (head === undefined || tail === undefined) {
    return undefined;
  }
  const explicit = head.groups.length + tail.groups.length;
  if (explicit > 7) {
    return undefined; // "::" must stand in for at least one zero group
  }
  let value = assembleIpv6Groups(head.groups);
  // The head owns the top groups; the shift spans gap + tail group slots.
  value <<= BigInt(16 * (8 - head.groups.length));
  return value | assembleIpv6Groups(tail.groups);
}

interface Ipv6Section {
  readonly groups: readonly bigint[];
}

/**
 * Parses one `::`-free section. `allowTrailingIpv4` permits the FINAL group
 * to be dotted-quad IPv4 (legal only at the address tail), which counts as
 * two 16-bit groups.
 */
function parseIpv6Section(text: string, allowTrailingIpv4: boolean): Ipv6Section | undefined {
  if (text.length === 0) {
    return { groups: [] };
  }
  const parts = text.split(":");
  const groups: bigint[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) {
      return undefined;
    }
    const isFinal = index === parts.length - 1;
    if (isFinal && allowTrailingIpv4 && part.includes(".")) {
      const embedded = parseIpv4(part);
      if (embedded === undefined) {
        return undefined;
      }
      groups.push((embedded >> 16n) & 0xffffn, embedded & 0xffffn);
      continue;
    }
    const groupValue = parseIpv6Group(part);
    if (groupValue === undefined) {
      return undefined;
    }
    groups.push(groupValue);
  }
  return { groups };
}

function assembleIpv6Groups(groups: readonly bigint[]): bigint {
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | group;
  }
  return value;
}

function parseIpv6Group(group: string): bigint | undefined {
  if (!IPV6_GROUP_PATTERN.test(group)) {
    return undefined;
  }
  return BigInt(`0x${group}`);
}

// --- Range policy -----------------------------------------------------------

interface AddressPrefix {
  readonly first: bigint;
  readonly mask: bigint;
}

function prefix4(first: string, bits: number): AddressPrefix {
  const mask = bits === 0 ? 0n : (1n << 32n) - (1n << BigInt(32 - bits));
  return { first: parseIpv4(first)!, mask };
}

function prefix6(first: string, bits: number): AddressPrefix {
  const mask = bits === 0 ? 0n : (1n << 128n) - (1n << BigInt(128 - bits));
  return { first: parseIpv6(first)!, mask };
}

function within(value: bigint, prefix: AddressPrefix): boolean {
  return (value & prefix.mask) === prefix.first;
}

/** Non-global IPv4 ranges (IANA special-purpose registry, core set). */
const IPV4_NON_PUBLIC: readonly AddressPrefix[] = [
  prefix4("0.0.0.0", 8), // "this network"
  prefix4("10.0.0.0", 8), // private
  prefix4("100.64.0.0", 10), // CGNAT shared
  prefix4("127.0.0.0", 8), // loopback
  prefix4("169.254.0.0", 16), // link-local (incl. cloud metadata endpoints)
  prefix4("172.16.0.0", 12), // private
  prefix4("192.0.0.0", 24), // IETF protocol assignments
  prefix4("192.0.2.0", 24), // TEST-NET-1 documentation
  prefix4("192.168.0.0", 16), // private
  prefix4("198.18.0.0", 15), // benchmarking
  prefix4("198.51.100.0", 24), // TEST-NET-2 documentation
  prefix4("203.0.113.0", 24), // TEST-NET-3 documentation
  prefix4("224.0.0.0", 4), // multicast
  prefix4("240.0.0.0", 4), // reserved / limited broadcast
];

export function isPublicIpv4(value: bigint): boolean {
  return !IPV4_NON_PUBLIC.some((prefix) => within(value, prefix));
}

// IPv6 prefixes whose policy follows an EMBEDDED IPv4 (mapped / translated).
const IPV4_MAPPED = prefix6("::ffff:0:0", 96);
const NAT64 = prefix6("64:ff9b::", 96);
const TEREDO = prefix6("2001:0::", 32);
const SIX_TO_FOUR = prefix6("2002::", 16);

/** Non-global native IPv6 prefixes. */
const IPV6_NON_GLOBAL: readonly AddressPrefix[] = [
  prefix6("::", 8), // IETF reserved (covers unspecified + loopback)
  prefix6("100::", 64), // discard-only
  prefix6("2001:db8::", 32), // documentation
  prefix6("fc00::", 7), // ULA private
  prefix6("fe80::", 10), // link-local
  prefix6("ff00::", 8), // multicast
];

/**
 * Whether an IPv6 address is global. IPv4-mapped (`::ffff:0:0/96`),
 * NAT64 (`64:ff9b::/96`), Teredo (`2001::/32`) and 6to4 (`2002::/16`)
 * addresses delegate to the EMBEDDED IPv4 policy instead of passing on
 * their own — a private IPv4 never becomes public by being wrapped.
 */
export function isPublicIpv6(value: bigint): boolean {
  if (within(value, IPV4_MAPPED) || within(value, NAT64)) {
    return isPublicIpv4(value & 0xffffffffn);
  }
  if (within(value, TEREDO)) {
    // Teredo server IPv4: bits 32..63.
    return isPublicIpv4((value >> 64n) & 0xffffffffn);
  }
  if (within(value, SIX_TO_FOUR)) {
    // 6to4 embedded public IPv4: bits 16..47.
    return isPublicIpv4((value >> 80n) & 0xffffffffn);
  }
  return !IPV6_NON_GLOBAL.some((prefix) => within(value, prefix));
}

// --- Top-level API ----------------------------------------------------------

/**
 * Detects the family of a host address string ("192.0.2.1" /
 * "2606:4700::1111") and returns it normalized.
 */
export function parseHostAddress(address: string): ParsedHostAddress | undefined {
  if (IPV4_PATTERN.test(address)) {
    return parseIpv4(address) === undefined ? undefined : { family: 4, address };
  }
  if (address.includes(":")) {
    return parseIpv6(address) === undefined ? undefined : { family: 6, address };
  }
  return undefined;
}

/** Whether a host address string is a public/global address. */
export function isPublicHostAddress(address: string): boolean {
  const parsed = parseHostAddress(address);
  if (parsed === undefined) {
    return false;
  }
  const value = parsed.family === 4 ? parseIpv4(address) : parseIpv6(address);
  if (value === undefined) {
    return false;
  }
  return parsed.family === 4 ? isPublicIpv4(value) : isPublicIpv6(value);
}
