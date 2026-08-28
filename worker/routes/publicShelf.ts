import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../types";
import type { Visibility } from "../middleware";
import { newToken } from "../lib/ids";
import { verifyPassphrase } from "../lib/passphrase";
import { rateLimit, clientIp } from "../lib/rate";

/* ---------------------------------------------------------------------------
 * PUBLIC SHELF. Everything in this file is reachable with no session at all,
 * which makes it the highest risk surface in the product. Three rules govern
 * the whole file.
 *
 * 1. "Does not exist" and "exists but you may not see it" must be the same
 *    response. Always 404 { error: "closed" }, never 403, never a different
 *    body, never a different status. A 403 confirms a real shelf and turns
 *    the slug space into a directory of the operator's clients.
 *
 * 2. Every payload is built by NAMING the fields that go out. Never take a
 *    row and delete the keys you do not want: the next migration adds a
 *    column, the delete list does not know about it, and it ships to the
 *    open internet silently.
 *
 * 3. A hidden tool must be invisible, not merely unrendered. It cannot show
 *    up as a count, a gap in sort_order, a shifted section heading, or a
 *    total that does not match the cards. That is why sort_order is fetched
 *    for ordering and then dropped, and why section order is computed over
 *    the visible rows only.
 *
 * No requireAuth here on purpose. There is no session and there is no owner
 * preview: the owner sees the owner-only blocks through the authenticated
 * app, not by getting a wider payload out of this route.
 * ------------------------------------------------------------------------- */

export const publicShelf = new Hono<{ Bindings: Env }>();

/**
 * Shelf visibilities that resolve at all. 'private' 404s like a typo.
 *
 * The tool-level equivalent is written into the two SELECTs as literals
 * rather than a constant. D1 cannot bind an IN list, so a constant here
 * would sit beside the queries looking authoritative while changing
 * nothing if it were edited.
 */
const OPEN_SHELF: Visibility[] = ["unlisted", "password", "public"];

const PW_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_SLUG_LENGTH = 64;
const MAX_PASSPHRASE_LENGTH = 256;

const closed = () => ({ error: "closed" }) as const;

/* ---------------------------------------------------------------------------
 * Passphrase hashing.
 *
 * The stored envelope is self describing:
 *
 *   pbkdf2$sha256$<iterations>$<salt base64url>$<derived key base64url>
 *
 * Iterations come out of the stored string rather than a constant here, so
 * raising the cost later re-hashes on next write without stranding every
 * existing shelf. The constants below are what a NEW hash should be written
 * with, and shelves.ts must write this exact envelope: a mismatch fails
 * closed and logs, it never silently accepts.
 * ------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
 * Passphrase session cookie.
 *
 * Scoped to the shelf by NAME, not by Path. Path scoping breaks the moment
 * the browser calls the API at one path and reads the page at another, and
 * the cookie silently stops being sent. The slug is already in the URL, so
 * putting it in the cookie name reveals nothing new.
 *
 * The real binding is server side anyway: the KV key is
 * shelfpw:{shelf_id}:{token}, so a token minted for one shelf does not
 * validate against another even if the cookie were replayed by hand.
 * ------------------------------------------------------------------------- */
const pwCookieName = (slug: string) =>
  `shelfpw_${slug.replace(/[^A-Za-z0-9_-]/g, "").slice(0, MAX_SLUG_LENGTH)}`;

function pwCookie(slug: string, token: string, url: URL): string {
  const secure = url.hostname === "localhost" ? "" : " Secure;";
  return `${pwCookieName(slug)}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${PW_COOKIE_TTL_SECONDS}`;
}

/* ---------------------------------------------------------------------------
 * Rows. Internal shapes, never returned. Every one of these carries at least
 * one field that must not leave the Worker.
 * ------------------------------------------------------------------------- */
type ShelfRow = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  client_name: string | null;
  logo_key: string | null;
  accent: string | null;
  visibility: Visibility;
  password_hash: string | null;
  owner_plan: string;
};

type ToolRow = {
  id: string;
  title: string;
  blurb: string | null;
  section: string | null;
  tag: string | null;
  status: string;
  screenshot_key: string | null;
  confirmed_at: number | null;
  sort_order: number;
};

type ToolDetailRow = ToolRow & { live_url: string; version: number };

/* ---------------------------------------------------------------------------
 * SERIALISERS. The allowlist. Read these as the definition of what a
 * stranger is allowed to know.
 *
 * Never present, at any depth: prompt, builder, builder_url, user_id,
 * shelf_id, password_hash, email, handle, custom_domain, visibility,
 * checked_at, sort_order, created_at, updated_at, and any reference to a
 * shelf other than this one.
 * ------------------------------------------------------------------------- */

/**
 * sort_order is fetched to order the grid and then dropped here. Publishing
 * it would republish the hidden tools: 10, 20, 40 tells the reader there is
 * a card at 30 they are not being shown.
 */
const publicTool = (t: ToolRow) => ({
  id: t.id,
  title: t.title,
  blurb: t.blurb,
  section: t.section,
  tag: t.tag,
  status: t.status,
  screenshot_key: t.screenshot_key,
  confirmed_at: t.confirmed_at,
});

/**
 * live_url appears here and nowhere else. The client-facing detail screen is
 * an "Open tool" button, so a detail payload without it has nothing to open.
 * A tool whose own visibility is private never reaches this function, so the
 * URL only ships for a tool the owner deliberately exposed.
 *
 * latest_note is the note on the newest snapshot, which the detail screen
 * shows as the version line. The snapshot's own live_url, screenshot_key and
 * prompt stay behind: the version history is the owner's working record.
 */
const publicToolDetail = (t: ToolDetailRow, latestNote: string | null) => ({
  ...publicTool(t),
  live_url: t.live_url,
  version: t.version,
  latest_note: latestNote,
});

/**
 * owner_plan becomes a boolean and stops there. The footer badge needs to
 * know "free plan", it does not need the operator's plan name, handle, or
 * anything else that identifies the account behind the shelf.
 */
const publicShelfHeader = (s: ShelfRow) => ({
  slug: s.slug,
  title: s.title,
  blurb: s.blurb,
  client_name: s.client_name,
  logo_key: s.logo_key,
  accent: s.accent,
  badge: s.owner_plan !== "studio",
});

type PublicSection = {
  section: string | null;
  tools: ReturnType<typeof publicTool>[];
};

/**
 * Sections order by the lowest sort_order among their tools, which falls out
 * of first appearance because the rows arrive sorted. The unnamed group is
 * pinned first regardless of where its lowest card sits, so a small shelf
 * with no sections looks like a plain grid.
 *
 * This runs over the VISIBLE rows only. Ordering sections by a hidden card's
 * sort_order would move a heading for a reason the reader cannot see, which
 * is the same leak as printing a count.
 */
function groupBySection(rows: ToolRow[]): PublicSection[] {
  const groups = new Map<string | null, PublicSection>();

  for (const row of rows) {
    const name = row.section?.trim() ? row.section.trim() : null;
    let group = groups.get(name);
    if (!group) {
      group = { section: name, tools: [] };
      groups.set(name, group);
    }
    group.tools.push(publicTool({ ...row, section: name }));
  }

  const ordered = [...groups.values()];
  const unnamed = ordered.findIndex((g) => g.section === null);
  if (unnamed > 0) ordered.unshift(...ordered.splice(unnamed, 1));
  return ordered;
}

/* ---------------------------------------------------------------------------
 * Lookups.
 * ------------------------------------------------------------------------- */

async function findShelf(env: Env, rawSlug: string): Promise<ShelfRow | null> {
  const slug = rawSlug.trim();
  if (!slug || slug.length > MAX_SLUG_LENGTH) return null;

  const sql = `SELECT s.id, s.slug, s.title, s.blurb, s.client_name, s.logo_key,
                      s.accent, s.visibility, s.password_hash, u.plan AS owner_plan
                 FROM shelves s
                 JOIN users u ON u.id = s.user_id
                WHERE s.slug = ?`;

  const exact = await env.DB.prepare(sql).bind(slug).first<ShelfRow>();
  if (exact) return exact;

  // Slugs are stored lowercase. Mail clients and phone keyboards capitalise,
  // and a client who cannot open their own link will not debug it.
  const lowered = slug.toLowerCase();
  if (lowered === slug) return null;
  return env.DB.prepare(sql).bind(lowered).first<ShelfRow>();
}

/**
 * A password shelf is locked until the visitor presents a token this Worker
 * minted for THIS shelf. A shelf marked password with no hash on it can
 * never be unlocked, and stays locked: failing open would publish the shelf
 * the moment someone cleared the hash.
 */
async function isUnlocked(env: Env, shelf: ShelfRow, cookieToken?: string) {
  if (shelf.visibility !== "password") return true;
  if (!shelf.password_hash || !cookieToken) return false;
  return (await env.KV.get(`shelfpw:${shelf.id}:${cookieToken}`)) !== null;
}

/* ---------------------------------------------------------------------------
 * Routes.
 * ------------------------------------------------------------------------- */

/**
 * no-store because an unlisted or unlocked payload must never sit in a shared
 * cache where the next visitor collects it. noindex because a client shelf is
 * reachable by link and is not meant to turn up in search.
 */
publicShelf.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  await next();
});

/** GET /:slug */
publicShelf.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const shelf = await findShelf(c.env, slug);

  // One response for missing, for private, and for a slug that was never
  // real. Do not split these apart later for a friendlier error.
  if (!shelf || !OPEN_SHELF.includes(shelf.visibility)) return c.json(closed(), 404);

  if (!(await isUnlocked(c.env, shelf, getCookie(c, pwCookieName(shelf.slug))))) {
    // The title only, so the gate can say which shelf is being opened. No
    // blurb, no client name, no logo, no tools, no count of tools.
    return c.json({ locked: true, title: shelf.title });
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, blurb, section, tag, status, screenshot_key,
            confirmed_at, sort_order
       FROM tools
      WHERE shelf_id = ?
        AND visibility IN ('unlisted', 'password', 'public')
      ORDER BY sort_order ASC, id ASC`
  )
    .bind(shelf.id)
    .all<ToolRow>();

  return c.json({
    shelf: publicShelfHeader(shelf),
    sections: groupBySection(results ?? []),
  });
});

/**
 * POST /:slug/unlock  { passphrase }
 *
 * Rate limited by IP first, before any lookup, and again per slug so a
 * botnet cannot spread a dictionary attack thin across addresses.
 */
publicShelf.post("/:slug/unlock", async (c) => {
  const ip = clientIp(c.req.raw);
  const byIp = await rateLimit(c.env, `unlock:ip:${ip}`, 10, 300);
  if (!byIp.ok) return c.json({ error: "rate_limited" }, 429);

  // Normalise BEFORE the key is built, with exactly the normalisation
  // findShelf uses. Keying on the raw param while resolving on a trimmed one
  // hands an attacker an unlimited supply of buckets for one shelf (" acme",
  // "  acme", "acme\t" all resolve to acme but count separately), which
  // defeats the per-shelf ceiling entirely and leaves only the per-IP one.
  // The length bound has to come first too: an over-long slug would otherwise
  // blow past KV's 512-byte key limit and throw a 500 out of rateLimit,
  // where every other unresolvable slug gets a 404.
  const slug = (c.req.param("slug") ?? "").trim().toLowerCase();
  if (!slug || slug.length > MAX_SLUG_LENGTH) return c.json(closed(), 404);

  const byShelf = await rateLimit(c.env, `unlock:slug:${slug}`, 30, 3600);
  if (!byShelf.ok) return c.json({ error: "rate_limited" }, 429);

  const body = await c.req
    .json<{ passphrase?: string }>()
    .catch(() => ({}) as { passphrase?: string });
  const passphrase = body.passphrase ?? "";

  const shelf = await findShelf(c.env, slug);

  // Not a real shelf, private, or not passphrase protected: all "closed".
  // Unlocking something with no gate on it is not a softer failure, it is a
  // question about which shelves have gates, and it gets no answer.
  if (!shelf || shelf.visibility !== "password" || !shelf.password_hash) {
    return c.json(closed(), 404);
  }

  if (
    !passphrase ||
    passphrase.length > MAX_PASSPHRASE_LENGTH ||
    !(await verifyPassphrase(shelf.password_hash, passphrase))
  ) {
    return c.json({ error: "wrong" }, 401);
  }

  const token = newToken();
  await c.env.KV.put(`shelfpw:${shelf.id}:${token}`, "1", {
    expirationTtl: PW_COOKIE_TTL_SECONDS,
  });

  c.header("Set-Cookie", pwCookie(shelf.slug, token, new URL(c.req.url)));
  return c.json({ ok: true });
});

/** GET /:slug/:toolId */
publicShelf.get("/:slug/:toolId", async (c) => {
  const slug = c.req.param("slug");
  const shelf = await findShelf(c.env, slug);
  if (!shelf || !OPEN_SHELF.includes(shelf.visibility)) return c.json(closed(), 404);

  if (!(await isUnlocked(c.env, shelf, getCookie(c, pwCookieName(shelf.slug))))) {
    return c.json({ locked: true, title: shelf.title });
  }

  // shelf_id is in the WHERE clause, not checked afterwards. Without it any
  // open slug becomes a reader for any tool id in the table.
  const tool = await c.env.DB.prepare(
    `SELECT id, title, blurb, section, tag, status, screenshot_key,
            confirmed_at, sort_order, live_url, version
       FROM tools
      WHERE id = ?
        AND shelf_id = ?
        AND visibility IN ('unlisted', 'password', 'public')`
  )
    .bind(c.req.param("toolId"), shelf.id)
    .first<ToolDetailRow>();

  // A private tool answers exactly as a tool id that does not exist.
  if (!tool) return c.json(closed(), 404);

  const latest = await c.env.DB.prepare(
    "SELECT note FROM snapshots WHERE tool_id = ? ORDER BY version DESC LIMIT 1"
  )
    .bind(tool.id)
    .first<{ note: string | null }>();

  return c.json({
    shelf: publicShelfHeader(shelf),
    tool: publicToolDetail(tool, latest?.note ?? null),
  });
});

