import "server-only";

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Fetch a URL a user pasted, without letting it reach anything inside our
 * network (SSRF). Every hop is resolved, every resolved address is checked, and
 * the socket connects to the address that was checked — a DNS answer that
 * changes between the check and the connect (rebinding) never gets a say.
 */

/** IPv4 ranges that are not the public internet. They also catch ::ffff:a.b.c.d. */
const DENIED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network" — 0.0.0.0 reaches localhost on Linux
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // docker bridges live here
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  DENIED.addSubnet(net, prefix, "ipv4");
}
// Inside global unicast, the blocks that embed or tunnel to another address.
DENIED.addSubnet("2001::", 23, "ipv6"); // Teredo and protocol assignments
DENIED.addSubnet("2001:db8::", 32, "ipv6");
DENIED.addSubnet("2002::", 16, "ipv6"); // 6to4 wraps an IPv4 address

/**
 * IPv6 is allow-listed to global unicast: that alone drops ::, ::1, mapped and
 * compatible IPv4 (::ffff:…), NAT64, ULA fc00::/7, link-local and multicast.
 */
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");

/** True only for an IP literal on the public internet. Brackets are allowed. */
export function isPublicAddress(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "");
  try {
    const family = isIP(host);
    if (family === 4) return !DENIED.check(host, "ipv4");
    if (family === 6) return GLOBAL_V6.check(host, "ipv6") && !DENIED.check(host, "ipv6");
  } catch {
    // a zone id or anything BlockList cannot parse is not a public address
  }
  return false;
}

/** A host NAME we are willing to resolve: no single-label or local-only names. */
export function isPublicHostname(name: string): boolean {
  const host = name.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) return isPublicAddress(host);
  // "kong", "db", "localhost", "metadata": docker and cluster names have no dot
  if (!host.includes(".")) return false;
  return !/\.(localhost|local|internal|lan|home\.arpa)$/.test(host);
}

/** Resolve a URL's host to ONE checked address, or null when any answer is private. */
async function resolvePublic(url: URL): Promise<{ address: string; family: number } | null> {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isPublicHostname(host)) return null;
  const literal = isIP(host);
  if (literal) return { address: host, family: literal };
  const answers = await lookup(host, { all: true });
  // every answer, not just the first: the socket could otherwise pick a private one
  if (answers.length === 0 || !answers.every((a) => isPublicAddress(a.address))) return null;
  return answers[0]!;
}

const MAX_REDIRECTS = 3;

/**
 * GET a public URL. Redirects are followed by hand (max 3), each hop re-checked;
 * the body is streamed and abandoned the moment it passes maxBytes. Null for
 * anything refused, non-2xx, or too large. Throws on network errors/timeout.
 */
export async function fetchPublic(
  raw: string,
  maxBytes: number,
  timeoutMs = 30_000,
): Promise<{ contentType: string; bytes: Buffer } | null> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await resolvePublic(url);
    if (!target) return null;
    // Pin: whatever Node would have resolved, it gets the address we checked.
    const pinned: LookupFunction = (_host, options, callback) => {
      if (options.all) callback(null, [target]);
      else callback(null, target.address, target.family);
    };
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const req = client.get(
        url,
        // agent:false — never reuse a socket opened for an earlier check
        { agent: false, lookup: pinned, signal, headers: { "user-agent": "Mozilla/5.0 (compatible; Traveliun)" } },
        resolve,
      );
      req.on("error", reject);
    });

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      return null;
    }
    if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
      res.destroy();
      return null;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        res.destroy();
        return null;
      }
      chunks.push(chunk as Buffer);
    }
    return { contentType: String(res.headers["content-type"] ?? "").toLowerCase(), bytes: Buffer.concat(chunks) };
  }
  return null; // too many redirects
}
