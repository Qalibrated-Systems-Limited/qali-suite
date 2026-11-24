/**
 * Is this IP address inside one of these networks? Pure, IPv4 and IPv6.
 *
 * A network is written as an address ("41.90.12.7") or a CIDR block
 * ("41.90.12.0/24", "2c0f:fe38::/32"). An IPv4 address that arrives as an
 * IPv6-mapped one ("::ffff:41.90.12.7") is matched as IPv4.
 */

function v4ToBigInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8n) + BigInt(v);
  }
  return n;
}

function v6ToBigInt(ip) {
  let s = ip.toLowerCase();
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hextets.
  const v4tail = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4tail) {
    const n = v4ToBigInt(v4tail[1]);
    if (n == null) return null;
    s = s.slice(0, -v4tail[1].length) + ((n >> 16n) & 0xffffn).toString(16) + ":" + (n & 0xffffn).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

/** { version: 4|6, value: BigInt } or null. IPv4-mapped IPv6 comes back as v4. */
export function parseIp(raw) {
  const ip = String(raw ?? "").trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!ip) return null;
  if (ip.includes(":")) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return parseIp(mapped[1]);
    const v = v6ToBigInt(ip);
    return v == null ? null : { version: 6, value: v };
  }
  const v = v4ToBigInt(ip);
  return v == null ? null : { version: 4, value: v };
}

/** { version, base, bits } for "a.b.c.d/n" or a bare address; null if invalid. */
export function parseNetwork(raw) {
  const [addr, len, extra] = String(raw ?? "").trim().split("/");
  if (extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.version === 4 ? 32 : 128;
  const bits = len === undefined ? max : /^\d{1,3}$/.test(len) ? Number(len) : NaN;
  if (!(bits >= 0 && bits <= max)) return null;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(max - bits);
  return { version: ip.version, base: ip.value & mask, bits, mask };
}

export function isValidNetwork(raw) {
  return parseNetwork(raw) !== null;
}

export function ipInNetworks(rawIp, networks) {
  const ip = parseIp(rawIp);
  if (!ip) return false;
  for (const n of networks || []) {
    const net = parseNetwork(n);
    if (net && net.version === ip.version && (ip.value & net.mask) === net.base) return true;
  }
  return false;
}

/**
 * The client's address as seen behind our reverse proxy. Caddy appends the
 * address it received the connection from to X-Forwarded-For (and, without
 * trusted_proxies set, does not trust one the client sent), so the RIGHTMOST
 * entry is the one we can believe. Falls back to X-Real-IP.
 */
export function clientIpFrom(headers) {
  const get = (k) => (typeof headers?.get === "function" ? headers.get(k) : headers?.[k]) || "";
  const xff = String(get("x-forwarded-for"));
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return String(get("x-real-ip")).trim() || null;
}
