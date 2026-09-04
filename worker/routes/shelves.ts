import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../types";
import {
  requireAuth,
  ownedShelf,
  clampVisibility,
  type Ctx,
  type Vars,
  type Visibility,
} from "../middleware";
import { newId, timingSafeEqual } from "../lib/ids";
import {
  hashPassphrase as sharedHash,
  PASSPHRASE_MIN,
  PASSPHRASE_MAX,
} from "../lib/passphrase";

/* ---------------------------------------------------------------------------
 * Shelves. One shelf per client, and the whole handoff hangs off it: the slug
 * is the link the client gets, the visibility is what that link will show,
 * and the roll-up is the answer to "is any of this still true".
 * ------------------------------------------------------------------------- */

const VISIBILITIES = ["private", "unlisted", "password", "public"] as const;

const TITLE_MAX = 120;
const BLURB_MAX = 400;
const CLIENT_NAME_MAX = 120;
const SLUG_MAX = 48;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Past this, a card reads "Needs confirming". PRD section 7, note 2. */
const STALE_MS = 90 * 24 * 60 * 60 * 1000;

type ShelfRow = {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  blurb: string | null;
  client_name: string | null;
  logo_key: string | null;
  accent: string | null;
  visibility: Visibility;
  password_hash: string | null;
  custom_domain: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

type ToolRow = {
  id: string;
  shelf_id: string;
  title: string;
  blurb: string | null;
  live_url: string;
  screenshot_key: string | null;
  section: string | null;
  tag: string | null;
  visibility: Visibility;
  sort_order: number;
  version: number;
  status: "live" | "down" | "draft";
  checked_at: number | null;
  confirmed_at: number | null;
  stack: string | null;
  prompt: string | null;
  builder: string | null;
  builder_url: string | null;
  created_at: number;
  updated_at: number;
};

export const shelves = new Hono<{ Bindings: Env; Variables: Vars }>();

// Every route here is owner-only. Mounted once so a new route cannot be
// added without it.
shelves.use("*", requireAuth);

/* ---------------------------------------------------------------------------
 * Serialisers.
 *
 * These are owner payloads, not public ones, but they are built the same way:
 * by naming every field. password_hash and user_id sit on the row and must
 * never ride along into a response, and the only reliable way to guarantee
 * that is to never spread the row.
 * ------------------------------------------------------------------------- */

function ownerShelf(row: ShelfRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    blurb: row.blurb,
    client_name: row.client_name,
    logo_key: row.logo_key,
    accent: row.accent,
    visibility: row.visibility,
    has_password: row.password_hash !== null,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ownerTool(row: ToolRow, now: number) {
  return {
    id: row.id,
    shelf_id: row.shelf_id,
    title: row.title,
    blurb: row.blurb,
    live_url: row.live_url,
    screenshot_key: row.screenshot_key,
    section: row.section,
    tag: row.tag,
    visibility: row.visibility,
    sort_order: row.sort_order,
    version: row.version,
    status: row.status,
    checked_at: row.checked_at,
    confirmed_at: row.confirmed_at,
    // Computed here so the 90 day rule has one definition, not one per screen.
    needs_confirming: needsConfirming(row.confirmed_at, now),
    stack: row.stack,
    prompt: row.prompt,
    builder: row.builder,
    builder_url: row.builder_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const needsConfirming = (confirmedAt: number | null, now: number) =>
  confirmedAt === null || confirmedAt < now - STALE_MS;

/**
 * One line for the shelf row. A shelf shows a single dot, so these are
 * ordered by what the owner has to act on first: something down beats
 * something merely unconfirmed.
 */
function rollUp(tools: number, down: number, stale: number) {
  if (tools === 0) return { state: "empty" as const, label: null };
  if (down > 0) return { state: "down" as const, label: `${down} down` };
  if (stale > 0) {
    return {
      state: "stale" as const,
      label: stale === 1 ? "1 needs confirming" : `${stale} need confirming`,
    };
  }
  return { state: "live" as const, label: "All live" };
}

/* ---------------------------------------------------------------------------
 * Input validation.
 * ------------------------------------------------------------------------- */

const bad = (message: string) => new HTTPException(400, { message });

async function readBody(c: Ctx): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw bad("invalid_body");
  }
  return body as Record<string, unknown>;
}

/** Required text. Rejects whitespace-only, which is how an empty title arrives. */
function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw bad(`${field}_required`);
  const trimmed = value.trim();
  if (!trimmed) throw bad(`${field}_required`);
  if (trimmed.length > max) throw bad(`${field}_too_long`);
  return trimmed;
}

/** Optional text. An empty string means "clear it", so it becomes NULL. */
function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw bad(`${field}_invalid`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw bad(`${field}_too_long`);
  return trimmed;
}

/**
 * Accent is a hex colour and nothing else. It is rendered into the client
 * shelf's styling, so an unvalidated string here is a CSS injection with the
 * owner's own client on the other end of it.
 */
function optionalAccent(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw bad("accent_invalid");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) throw bad("accent_invalid");
  return trimmed.toLowerCase();
}

function asVisibility(value: unknown): Visibility {
  if (typeof value !== "string" || !(VISIBILITIES as readonly string[]).includes(value)) {
    throw bad("visibility_invalid");
  }
  return value as Visibility;
}

function asSortOrder(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw bad("sort_order_invalid");
  return n;
}

/* ---------------------------------------------------------------------------
 * Passphrase, for visibility = 'password'.
 *
 * PBKDF2-SHA256 through crypto.subtle: Workers has no bcrypt or argon2, and
 * the iteration count is capped at 100k by the runtime, so that is the
 * ceiling rather than a tuning choice.
 *
 * Stored as  pbkdf2$<iterations>$<salt b64>$<digest b64>  so the parameters
 * travel with the hash and an older row stays verifiable after a change here.
 * ------------------------------------------------------------------------- */

// Passphrase hashing lives in worker/lib/passphrase.ts. It is imported, not
// re-implemented here: this file and publicShelf.ts once each invented their
// own envelope and a correct passphrase could never open a gated shelf.
async function hashPassphrase(raw: unknown): Promise<string> {
  if (typeof raw !== "string") throw bad("passphrase_required");
  const passphrase = raw.trim();
  if (passphrase.length < PASSPHRASE_MIN) throw bad("passphrase_too_short");
  if (passphrase.length > PASSPHRASE_MAX) throw bad("passphrase_too_long");
  return sharedHash(passphrase);
}

/* ---------------------------------------------------------------------------
 * Slug.
 * ------------------------------------------------------------------------- */

function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // drop the accents NFKD just split off
    .replace(/['\u2018\u2019]/g, "") // Maria's -> marias, not maria-s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  // A title of pure punctuation or non-Latin script leaves nothing behind.
  return base || "shelf";
}

/**
 * shelves.slug is unique across ALL accounts, not per user, because /s/:slug
 * has no user in the path. So a collision here is usually a stranger's shelf,
 * not the owner's, and the suffix has to be picked against the whole table.
 */
async function nextFreeSlug(c: Ctx, base: string): Promise<string> {
  const { results } = await c.env.DB.prepare(
    "SELECT slug FROM shelves WHERE slug = ? OR slug LIKE ?"
  )
    .bind(base, `${base}-%`)
    .all<{ slug: string }>();

  const taken = new Set((results ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;

  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${newId("x").slice(-8).toLowerCase()}`;
}

const isSlugCollision = (err: unknown) =>
  /UNIQUE constraint failed/i.test((err as Error)?.message ?? "");

/* ---------------------------------------------------------------------------
 * Visibility clamp.
 * ------------------------------------------------------------------------- */

/**
 * Re-run the clamp across every tool on the shelf. Called whenever the shelf's
 * own visibility is written, not only when it looks like a narrowing: the rank
 * comparison lives inside clampVisibility, and re-running it is idempotent, so
 * this cannot be got wrong by mis-reading which direction is narrower.
 */
async function reclampTools(
  c: Ctx,
  shelfId: string,
  shelfVisibility: Visibility,
  now: number
): Promise<number> {
  const { results } = await c.env.DB.prepare(
    "SELECT id, visibility FROM tools WHERE shelf_id = ?"
  )
    .bind(shelfId)
    .all<{ id: string; visibility: Visibility }>();

  const updates: D1PreparedStatement[] = [];
  for (const tool of results ?? []) {
    const clamped = clampVisibility(tool.visibility, shelfVisibility);
    if (clamped === tool.visibility) continue;
    updates.push(
      c.env.DB.prepare(
        "UPDATE tools SET visibility = ?, updated_at = ? WHERE id = ?"
      ).bind(clamped, now, tool.id)
    );
  }

  if (updates.length) await c.env.DB.batch(updates);
  return updates.length;
}

/* ---------------------------------------------------------------------------
 * GET /  the shelves list.
 * ------------------------------------------------------------------------- */

shelves.get("/", async (c) => {
  const now = Date.now();
  const staleBefore = now - STALE_MS;

  // One grouped query rather than a count per shelf: the list is the home
  // screen and it should not scale its round trips with the client count.
  const { results } = await c.env.DB.prepare(
    `SELECT s.*,
            COUNT(t.id) AS tool_count,
            COALESCE(SUM(CASE WHEN t.status = 'down' THEN 1 ELSE 0 END), 0) AS down_count,
            COALESCE(SUM(CASE WHEN t.confirmed_at IS NULL OR t.confirmed_at < ?
                              THEN 1 ELSE 0 END), 0) AS stale_count,
            MAX(t.updated_at) AS tools_updated_at
       FROM shelves s
       LEFT JOIN tools t ON t.shelf_id = s.id
      WHERE s.user_id = ?
      GROUP BY s.id
      ORDER BY s.sort_order, s.created_at`
  )
    .bind(staleBefore, c.var.user.id)
    .all<
      ShelfRow & {
        tool_count: number;
        down_count: number;
        stale_count: number;
        tools_updated_at: number | null;
      }
    >();

  const list = (results ?? []).map((row) => ({
    ...ownerShelf(row),
    tool_count: row.tool_count,
    last_activity: Math.max(row.updated_at, row.tools_updated_at ?? 0),
    status: rollUp(row.tool_count, row.down_count, row.stale_count),
  }));

  return c.json({ shelves: list });
});

/* ---------------------------------------------------------------------------
 * POST /  create.
 * ------------------------------------------------------------------------- */

shelves.post("/", async (c) => {
  const body = await readBody(c);
  const title = requiredText(body.title, "title", TITLE_MAX);

  const now = Date.now();
  const id = newId("shl");
  const blurb = optionalText(body.blurb, "blurb", BLURB_MAX);
  const clientName = optionalText(body.client_name, "client_name", CLIENT_NAME_MAX);
  const accent = optionalAccent(body.accent);

  // New shelves land at the bottom of the owner's list.
  const tail = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM shelves WHERE user_id = ?"
  )
    .bind(c.var.user.id)
    .first<{ next: number }>();
  const sortOrder = tail?.next ?? 0;

  const base = slugify(title);

  // Checking then inserting is a race against every other account on the
  // platform, so the UNIQUE index is the real arbiter and a collision just
  // means picking the next suffix and trying again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await nextFreeSlug(c, base);
    try {
      await c.env.DB.prepare(
        `INSERT INTO shelves
           (id, user_id, slug, title, blurb, client_name, accent, visibility,
            sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?)`
      )
        .bind(id, c.var.user.id, slug, title, blurb, clientName, accent, sortOrder, now, now)
        .run();

      // Private until the owner deliberately opens it. A shelf that arrives
      // shareable is a client's work published by default.
      return c.json(
        {
          shelf: {
            id,
            slug,
            title,
            blurb,
            client_name: clientName,
            logo_key: null,
            accent,
            visibility: "private" as Visibility,
            has_password: false,
            sort_order: sortOrder,
            created_at: now,
            updated_at: now,
          },
          tool_count: 0,
          last_activity: now,
          status: rollUp(0, 0, 0),
        },
        201
      );
    } catch (err) {
      if (!isSlugCollision(err)) throw err;
    }
  }

  throw new HTTPException(409, { message: "slug_unavailable" });
});

/* ---------------------------------------------------------------------------
 * GET /:id  one shelf and its tools.
 * ------------------------------------------------------------------------- */

shelves.get("/:id", async (c) => {
  const shelf = await ownedShelf<ShelfRow>(c, c.req.param("id"));

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM tools WHERE shelf_id = ? ORDER BY sort_order, created_at"
  )
    .bind(shelf.id)
    .all<ToolRow>();

  const now = Date.now();
  const tools = (results ?? []).map((t) => ownerTool(t, now));

  return c.json({
    shelf: ownerShelf(shelf),
    tools,
    status: rollUp(
      tools.length,
      tools.filter((t) => t.status === "down").length,
      tools.filter((t) => t.needs_confirming).length
    ),
  });
});

/* ---------------------------------------------------------------------------
 * PATCH /:id  update.
 * ------------------------------------------------------------------------- */

shelves.patch("/:id", async (c) => {
  const shelf = await ownedShelf<ShelfRow>(c, c.req.param("id"));
  const body = await readBody(c);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  if ("title" in body) set("title", requiredText(body.title, "title", TITLE_MAX));
  if ("blurb" in body) set("blurb", optionalText(body.blurb, "blurb", BLURB_MAX));
  if ("client_name" in body) {
    set("client_name", optionalText(body.client_name, "client_name", CLIENT_NAME_MAX));
  }
  if ("accent" in body) set("accent", optionalAccent(body.accent));
  if ("sort_order" in body) set("sort_order", asSortOrder(body.sort_order));

  const visibility = "visibility" in body ? asVisibility(body.visibility) : shelf.visibility;

  if ("visibility" in body) set("visibility", visibility);

  if (visibility === "password") {
    if ("passphrase" in body) {
      set("password_hash", await hashPassphrase(body.passphrase));
    } else if (!shelf.password_hash) {
      // A password shelf with no hash would fall open, so this is a hard stop
      // rather than a silent downgrade to unlisted.
      throw bad("passphrase_required");
    }
  } else if (shelf.password_hash) {
    // Leaving the old hash behind means switching back to 'password' months
    // later silently re-arms a passphrase nobody remembers setting.
    set("password_hash", null);
  }

  if (!sets.length) return c.json({ shelf: ownerShelf(shelf), reclamped: 0 });

  const now = Date.now();
  set("updated_at", now);
  binds.push(shelf.id);

  await c.env.DB.prepare(`UPDATE shelves SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  // Ownership was established by ownedShelf above, so this reads the row back
  // by id alone.
  const reclamped =
    "visibility" in body ? await reclampTools(c, shelf.id, visibility, now) : 0;

  const updated = await c.env.DB.prepare("SELECT * FROM shelves WHERE id = ?")
    .bind(shelf.id)
    .first<ShelfRow>();

  return c.json({ shelf: ownerShelf(updated ?? shelf), reclamped });
});

/* ---------------------------------------------------------------------------
 * DELETE /:id
 * ------------------------------------------------------------------------- */

shelves.delete("/:id", async (c) => {
  const shelf = await ownedShelf<ShelfRow>(c, c.req.param("id"));

  // R2 has no cascade. Collect the keys before the rows go, or a deleted
  // client's screenshots sit in the bucket forever.
  const { results } = await c.env.DB.prepare(
    "SELECT screenshot_key FROM tools WHERE shelf_id = ? AND screenshot_key IS NOT NULL"
  )
    .bind(shelf.id)
    .all<{ screenshot_key: string }>();

  const keys = (results ?? []).map((r) => r.screenshot_key);
  if (shelf.logo_key) keys.push(shelf.logo_key);

  // FKs cascade to tools and, through them, to snapshots.
  await c.env.DB.prepare("DELETE FROM shelves WHERE id = ?").bind(shelf.id).run();

  // Best effort. The row is already gone; a failed object delete is a
  // housekeeping problem, not a failed request.
  if (keys.length) {
    try {
      await c.env.FILES.delete(keys);
    } catch (err) {
      console.error("shelf delete: r2 cleanup failed:", (err as Error).message);
    }
  }

  return c.json({ ok: true });
});

/* ---------------------------------------------------------------------------
 * POST /:id/logo  multipart upload to R2.
 * ------------------------------------------------------------------------- */

/**
 * Content-Type and filename are both attacker-supplied, so neither decides
 * what this file is. The first bytes do.
 */
function sniffImage(bytes: Uint8Array): { ext: "png" | "jpg"; type: string } | null {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) {
    return { ext: "png", type: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", type: "image/jpeg" };
  }
  return null;
}

shelves.post("/:id/logo", async (c) => {
  const shelf = await ownedShelf<ShelfRow>(c, c.req.param("id"));

  const form = await c.req.raw.formData().catch(() => null);
  if (!form) throw bad("invalid_upload");

  const field = form.get("file") ?? form.get("logo");
  if (!field || typeof field === "string") throw bad("file_required");

  const file = field as File;
  if (file.size > MAX_LOGO_BYTES) {
    throw new HTTPException(413, { message: "file_too_large" });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // file.size is a claim. This is the measurement.
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new HTTPException(413, { message: "file_too_large" });
  }

  const kind = sniffImage(bytes);
  if (!kind) throw bad("unsupported_image");

  // Keyed on the real extension, so the stored object and its content type
  // agree. Overwrites the previous logo of the same format in place.
  const key = `logos/${c.var.user.id}/${shelf.id}.${kind.ext}`;

  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: kind.type } });

  if (shelf.logo_key && shelf.logo_key !== key) {
    try {
      await c.env.FILES.delete(shelf.logo_key);
    } catch (err) {
      console.error("logo upload: stale object left behind:", (err as Error).message);
    }
  }

  const now = Date.now();
  await c.env.DB.prepare("UPDATE shelves SET logo_key = ?, updated_at = ? WHERE id = ?")
    .bind(key, now, shelf.id)
    .run();

  return c.json({ logo_key: key, updated_at: now });
});
