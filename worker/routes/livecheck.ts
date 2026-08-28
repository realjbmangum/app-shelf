import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth, ownedTool, type Vars } from "../middleware";
import { rateLimit } from "../lib/rate";

/* ---------------------------------------------------------------------------
 * Live check. Mounted at /api/tools, so the route below is
 * POST /api/tools/:id/ping. The cron entry point is runScheduledCheck.
 *
 * This module is an outbound fetch proxy driven by URLs a user typed. That is
 * the classic SSRF shape: our Worker sits inside Cloudflare's network and will
 * happily fetch whatever it is pointed at, so every URL is hostile until
 * assertFetchable has cleared it. Non-negotiable #3 in CLAUDE.md.
 *
 * It writes status and checked_at. It never writes confirmed_at. A machine
 * getting a 200 is not a human saying the tool is still real, and merging the
 * two is the exact bug this product exists to prevent.
 * ------------------------------------------------------------------------- */

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "ShelfLiveCheck/1.0";

/** Ports a public web app is plausibly served on. Everything else is a scan. */
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Hosts that reject HEAD outright. Retry these with a one byte GET. */
const HEAD_UNSUPPORTED = new Set([400, 403, 405, 501]);

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/** Permanent problem with the URL itself. The tool is not reachable, ever. */
export class UnsafeUrlError extends Error {
  constructor(readonly reason: string) {
    super(`unsafe_url:${reason}`);
    this.name = "UnsafeUrlError";
  }
}

/**
 * We could not determine anything, so we must not record anything. Distinct
 * from "down" on purpose: writing down when our own resolver failed would put
 * a red dot on a healthy tool in front of the client.
 */
export class CheckUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`check_unavailable:${reason}`);
    this.name = "CheckUnavailableError";
  }
}

/* ---------------------------------------------------------------------------
 * Address parsing.
 *
 * We do not trust the runtime to have normalised the host for us. WHATWG URL
 * does canonicalise 2130706433 and 0x7f.0.0.1 down to 127.0.0.1, but a guard
 * that only works because of that is one runtime change away from being a
 * hole, and it never handled the trailing dot form (127.0.0.1.) at all.
 * ------------------------------------------------------------------------- */

const ip4 = (a: number, b: number, c: number, d: number) =>
  ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

/** [network, prefix bits]. Anything not publicly routable. */
const V4_BLOCKS: Array<[number, number]> = [
  [ip4(0, 0, 0, 0), 8], // this host, this network
  [ip4(10, 0, 0, 0), 8], // RFC1918
  [ip4(100, 64, 0, 0), 10], // CGNAT, and Alibaba metadata at 100.100.100.200
  [ip4(127, 0, 0, 0), 8], // loopback
  [ip4(169, 254, 0, 0), 16], // link local, and 169.254.169.254 cloud metadata
  [ip4(172, 16, 0, 0), 12], // RFC1918
  [ip4(192, 0, 0, 0), 24], // IETF protocol assignments
  [ip4(192, 168, 0, 0), 16], // RFC1918
  [ip4(198, 18, 0, 0), 15], // benchmarking
  [ip4(224, 0, 0, 0), 4], // multicast
  [ip4(240, 0, 0, 0), 4], // reserved, includes 255.255.255.255
];

/** Names that only ever resolve inside somebody's network. */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal", // covers metadata.google.internal
  ".home.arpa",
  ".localdomain",
];

/** One octet in decimal, octal (0…) or hex (0x…), the three standard bypasses. */
function parseOctet(part: string): number | null {
  if (part === "") return null;
  if (/^0[xX][0-9a-fA-F]*$/.test(part)) {
    return part.length === 2 ? 0 : parseInt(part.slice(2), 16);
  }
  if (/^0[0-7]+$/.test(part)) return parseInt(part.slice(1), 8);
  if (/^[0-9]+$/.test(part)) return parseInt(part, 10);
  return null;
}

/**
 * Returns the address as an unsigned 32 bit number, or null when the host is
 * not an IPv4 literal in any notation. Accepts the short forms too: the last
 * part absorbs the remaining octets, so 127.1 is 127.0.0.1 and 2130706433 is
 * the same host again.
 */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    const n = parseOctet(part);
    if (n === null || n < 0) return null;
    nums.push(n);
  }

  const last = nums[nums.length - 1] as number;
  for (let i = 0; i < nums.length - 1; i++) {
    if ((nums[i] as number) > 255) return null;
  }
  if (last >= Math.pow(256, 4 - (nums.length - 1))) return null;

  let value = last;
  for (let i = 0; i < nums.length - 1; i++) {
    value += (nums[i] as number) * Math.pow(256, 3 - i);
  }
  return value >>> 0;
}

/** Strict dotted quad, used only for the IPv4 tail of an IPv6 literal. */
function parseDottedQuad(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return ip4(o[0] as number, o[1] as number, o[2] as number, o[3] as number);
}

/** 16 bytes, or null. Handles :: compression and the ::ffff:1.2.3.4 tail. */
function parseIPv6(input: string): Uint8Array | null {
  if (!input.includes(":")) return null;

  let s = input.toLowerCase();

  // Rewrite an embedded IPv4 tail into two hex groups so the rest of the
  // parser only has to deal with one notation.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseDottedQuad(tail);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const dbl = s.indexOf("::");
  let headPart = s;
  let tailPart = "";
  if (dbl >= 0) {
    if (s.indexOf("::", dbl + 1) > dbl) return null; // only one :: is legal
    headPart = s.slice(0, dbl);
    tailPart = s.slice(dbl + 2);
  }

  const head = headPart === "" ? [] : headPart.split(":");
  const rest = tailPart === "" ? [] : tailPart.split(":");
  if (dbl < 0 && head.length !== 8) return null;
  if (head.length + rest.length > 8) return null;

  const groups = new Array<number>(8).fill(0);
  const hex = (t: string) => (/^[0-9a-f]{1,4}$/.test(t) ? parseInt(t, 16) : null);

  for (let i = 0; i < head.length; i++) {
    const g = hex(head[i] as string);
    if (g === null) return null;
    groups[i] = g;
  }
  for (let i = 0; i < rest.length; i++) {
    const g = hex(rest[i] as string);
    if (g === null) return null;
    groups[8 - rest.length + i] = g;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = ((groups[i] as number) >> 8) & 0xff;
    bytes[i * 2 + 1] = (groups[i] as number) & 0xff;
  }
  return bytes;
}

function assertIPv4Allowed(addr: number): void {
  for (const [net, bits] of V4_BLOCKS) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((addr & mask) >>> 0 === net) throw new UnsafeUrlError("private_address");
  }
}

function assertIPv6Allowed(b: Uint8Array): void {
  const prefixIsZero = b.slice(0, 12).every((x) => x === 0);
  const isMapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  const v4Tail = () => ip4(b[12] as number, b[13] as number, b[14] as number, b[15] as number);

  // ::1 and :: fall out of the v4 rules below as 0.0.0.1 and 0.0.0.0, both
  // inside 0.0.0.0/8, but say it out loud so nobody has to work that out.
  if (prefixIsZero || isMapped) {
    assertIPv4Allowed(v4Tail());
    return;
  }
  // 64:ff9b::/96 NAT64 and 2002::/16 6to4 both carry a v4 address that would
  // otherwise reach a private host through a translator.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    assertIPv4Allowed(v4Tail());
    return;
  }
  if (b[0] === 0x20 && b[1] === 0x02) {
    assertIPv4Allowed(ip4(b[2] as number, b[3] as number, b[4] as number, b[5] as number));
    return;
  }
  if (((b[0] as number) & 0xfe) === 0xfc) throw new UnsafeUrlError("private_address"); // fc00::/7
  if (b[0] === 0xfe && ((b[1] as number) & 0xc0) === 0x80) {
    throw new UnsafeUrlError("private_address"); // fe80::/10
  }
  if (b[0] === 0xff) throw new UnsafeUrlError("private_address"); // ff00::/8 multicast
}

function assertHostAllowed(rawHost: string): void {
  let host = rawHost.toLowerCase();
  if (!host) throw new UnsafeUrlError("bad_url");

  // A percent in a host is either an IPv6 zone id (fe80::1%eth0) or an
  // encoding trick. Neither belongs in a public URL.
  if (host.includes("%")) throw new UnsafeUrlError("bad_url");

  if (host.startsWith("[")) {
    if (!host.endsWith("]")) throw new UnsafeUrlError("bad_url");
    const bytes = parseIPv6(host.slice(1, -1));
    if (!bytes) throw new UnsafeUrlError("bad_url");
    assertIPv6Allowed(bytes);
    return;
  }

  // "127.0.0.1." and "metadata.google.internal." are the same hosts with the
  // root label spelled out.
  if (host.endsWith(".")) host = host.slice(0, -1);

  const v4 = parseIPv4(host);
  if (v4 !== null) {
    assertIPv4Allowed(v4);
    return;
  }

  if (host === "localhost") throw new UnsafeUrlError("internal_hostname");
  // A single label never resolves on the public internet, but it does resolve
  // on a private search domain, and "metadata" is one of them.
  if (!host.includes(".")) throw new UnsafeUrlError("internal_hostname");
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) throw new UnsafeUrlError("internal_hostname");
  }
}

/**
 * The guard. Throws UnsafeUrlError on anything we will not fetch, returns the
 * parsed URL when it is safe. Call this on the original URL AND on every
 * redirect target: a 302 to 169.254.169.254 walks straight through a guard
 * that only looked at the first hop.
 */
export function assertFetchable(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("bad_url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("scheme");
  }
  // Credentials in the URL are how you get a Worker to authenticate against
  // something on its own network.
  if (url.username || url.password) throw new UnsafeUrlError("credentials");
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError("port");

  assertHostAllowed(url.hostname);
  return url;
}

/* ---------------------------------------------------------------------------
 * DNS.
 *
 * The syntactic guard above stops someone typing an internal address. It does
 * nothing about evil.example.com with an A record pointing at 169.254.169.254,
 * which is the SSRF everyone actually gets hit by. Workers has no resolver
 * API, so we ask Cloudflare's over DoH and check every answer.
 *
 * Known limit, stated rather than papered over: fetch resolves the name again
 * itself, so a rebinding attacker with a one second TTL can still win the race
 * between our lookup and that one. Closing it properly means dialling the IP
 * directly with a Host header, which breaks SNI and certificate validation.
 * This raises the cost a long way without pretending to be airtight.
 * ------------------------------------------------------------------------- */

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

async function dnsQuery(
  host: string,
  type: "A" | "AAAA",
  signal: AbortSignal
): Promise<string[]> {
  let body: { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  try {
    const res = await fetch(
      `${DOH_ENDPOINT}?name=${encodeURIComponent(host)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal }
    );
    if (!res.ok) throw new Error(`resolver ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    if (signal.aborted) throw new CheckUnavailableError("timeout");
    throw new CheckUnavailableError((err as Error).message);
  }

  if (body.Status === 3) return []; // NXDOMAIN, a real answer: nothing there
  if (body.Status !== 0) throw new CheckUnavailableError(`resolver_status_${body.Status}`);

  const want = type === "A" ? 1 : 28;
  return (body.Answer ?? [])
    .filter((a) => a.type === want && typeof a.data === "string")
    .map((a) => a.data as string);
}

/** Throws UnsafeUrlError if the name resolves anywhere we will not go. */
async function assertResolvedHostSafe(url: URL, signal: AbortSignal): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // Literals were fully checked by assertFetchable, and there is nothing to
  // look up.
  if (host.startsWith("[") || parseIPv4(host) !== null) return;

  const [a, aaaa] = await Promise.all([
    dnsQuery(host, "A", signal),
    dnsQuery(host, "AAAA", signal),
  ]);
  if (a.length === 0 && aaaa.length === 0) throw new UnsafeUrlError("dns");

  for (const rec of a) {
    const addr = parseIPv4(rec);
    if (addr === null) throw new UnsafeUrlError("dns");
    assertIPv4Allowed(addr);
  }
  for (const rec of aaaa) {
    const bytes = parseIPv6(rec);
    if (!bytes) throw new UnsafeUrlError("dns");
    assertIPv6Allowed(bytes);
  }
}

/* ---------------------------------------------------------------------------
 * The check itself.
 * ------------------------------------------------------------------------- */

export type CheckResult = {
  status: "live" | "down";
  code: number | null;
  reason: string | null;
  checked_at: number;
};

/** HEAD first. The body is never read, only cancelled. */
async function probe(url: URL, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "*/*" };
  const target = url.toString();

  let res = await fetch(target, { method: "HEAD", redirect: "manual", signal, headers });
  if (HEAD_UNSUPPORTED.has(res.status)) {
    void res.body?.cancel();
    // One byte, so a misbehaving host cannot make us pull down a large file.
    res = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { ...headers, range: "bytes=0-0" },
    });
  }
  return res;
}

/**
 * Resolve one URL to live or down. Throws CheckUnavailableError when the
 * answer is genuinely unknown, so callers can decline to write anything.
 */
export async function checkUrl(raw: string): Promise<CheckResult> {
  const checked_at = Date.now();
  // One five second budget for the whole thing, redirects and DNS included.
  // A per hop timeout would let four hops hold a cron tick for twenty seconds.
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  const down = (reason: string, code: number | null = null): CheckResult => ({
    status: "down",
    code,
    reason,
    checked_at,
  });

  let target: URL;
  try {
    target = assertFetchable(raw);
  } catch (err) {
    return down(err instanceof UnsafeUrlError ? err.reason : "bad_url");
  }

  for (let hop = 0; ; hop++) {
    try {
      await assertResolvedHostSafe(target, signal);
    } catch (err) {
      if (err instanceof UnsafeUrlError) return down(err.reason);
      throw err; // CheckUnavailableError, up to the caller
    }

    let res: Response;
    try {
      res = await probe(target, signal);
    } catch (err) {
      const name = (err as Error).name;
      return down(signal.aborted || name === "TimeoutError" ? "timeout" : "network");
    }

    const location = REDIRECT_CODES.has(res.status) ? res.headers.get("location") : null;
    void res.body?.cancel();

    if (!location) {
      const live = res.status >= 200 && res.status < 400;
      return {
        status: live ? "live" : "down",
        code: res.status,
        reason: live ? null : "http_status",
        checked_at,
      };
    }

    if (hop >= MAX_REDIRECTS) return down("too_many_redirects", res.status);

    try {
      // Relative Location headers are legal and common, hence the base.
      target = assertFetchable(new URL(location, target).toString());
    } catch (err) {
      return down(err instanceof UnsafeUrlError ? err.reason : "bad_url", res.status);
    }
  }
}

/* ---------------------------------------------------------------------------
 * Persistence.
 *
 * Two things this deliberately leaves alone:
 *
 * confirmed_at, because a 200 is not a human confirmation. If a check could
 * re-date it, every dead tool would read as confirmed forever and the 90 day
 * staleness flag would never fire once.
 *
 * updated_at, because the dashboard shows it as last activity. A cron running
 * every six hours would otherwise report every shelf as active minutes ago,
 * which is worse than showing nothing.
 *
 * status is left alone for drafts. Draft shares the status column with live
 * and down, so writing a check result over it would silently publish a card
 * the owner has not finished.
 * ------------------------------------------------------------------------- */
function recordStatus(env: Env, toolId: string, result: CheckResult) {
  return env.DB.prepare(
    `UPDATE tools
        SET status = CASE WHEN status = 'draft' THEN status ELSE ? END,
            checked_at = ?
      WHERE id = ?`
  ).bind(result.status, result.checked_at, toolId);
}

/* ---------------------------------------------------------------------------
 * Routes.
 * ------------------------------------------------------------------------- */

export const livecheck = new Hono<{ Bindings: Env; Variables: Vars }>();

livecheck.use("*", requireAuth);

/**
 * POST /:id/ping
 *
 * Rate limited twice. Per tool stops one card being used as a repeat-request
 * cannon at a third party, per user stops the same trick spread across a
 * hundred tools the attacker created themselves.
 */
livecheck.post("/:id/ping", async (c) => {
  const user = c.var.user;

  // User budget first: an authenticated attacker guessing tool ids should not
  // get an unlimited number of ownership lookups out of us.
  const userLimit = await rateLimit(c.env, `ping:user:${user.id}`, 30, 3600);
  if (!userLimit.ok) return c.json({ error: "rate_limited" }, 429);

  const tool = await ownedTool<{ id: string; live_url: string | null }>(
    c,
    c.req.param("id")
  );

  const toolLimit = await rateLimit(c.env, `ping:tool:${tool.id}`, 6, 3600);
  if (!toolLimit.ok) return c.json({ error: "rate_limited" }, 429);

  const url = (tool.live_url ?? "").trim();
  if (!url) return c.json({ error: "no_live_url" }, 400);

  let result: CheckResult;
  try {
    result = await checkUrl(url);
  } catch (err) {
    if (err instanceof CheckUnavailableError) {
      console.error("live check unavailable:", err.message);
      return c.json({ error: "check_unavailable" }, 503);
    }
    throw err;
  }

  await recordStatus(c.env, tool.id, result).run();

  // Named fields only. Never spread the tool row: it carries prompt and
  // builder_url, and this response shape has a habit of getting reused.
  return c.json({
    id: tool.id,
    status: result.status,
    code: result.code,
    reason: result.reason,
    checked_at: result.checked_at,
  });
});

/* ---------------------------------------------------------------------------
 * Cron. Wired to the six hourly trigger by the scheduled handler.
 * ------------------------------------------------------------------------- */

/** Cap per tick. Worst case is about ten subrequests per tool, so a full
 *  batch stays well inside the Worker subrequest ceiling, and the table can
 *  grow without one tick ever trying to walk all of it. */
const BATCH_SIZE = 40;
const CONCURRENCY = 6;

export async function runScheduledCheck(env: Env): Promise<{ checked: number; down: number }> {
  // SQLite sorts NULL first, so tools that have never been checked lead, then
  // the stalest. Backed by idx_tools_live_check.
  const { results } = await env.DB.prepare(
    `SELECT id, live_url FROM tools
      WHERE live_url IS NOT NULL AND live_url <> '' AND status <> 'draft'
      ORDER BY checked_at ASC
      LIMIT ?`
  )
    .bind(BATCH_SIZE)
    .all<{ id: string; live_url: string }>();

  const tools = results ?? [];
  const updates: D1PreparedStatement[] = [];
  let down = 0;

  for (let i = 0; i < tools.length; i += CONCURRENCY) {
    const slice = tools.slice(i, i + CONCURRENCY);
    const checks = await Promise.all(
      slice.map(async (tool) => {
        try {
          return { tool, result: await checkUrl(tool.live_url) };
        } catch (err) {
          // Unknown is not down. Leave status and checked_at as they are so
          // this tool sorts first and gets retried next tick.
          console.error("live check skipped", tool.id, (err as Error).message);
          return null;
        }
      })
    );

    for (const check of checks) {
      if (!check) continue;
      if (check.result.status === "down") down++;
      updates.push(recordStatus(env, check.tool.id, check.result));
    }
  }

  if (updates.length) await env.DB.batch(updates);
  return { checked: updates.length, down };
}
