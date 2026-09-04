import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../types";
import {
  requireAuth,
  ownedShelf,
  ownedTool,
  clampVisibility,
  type Ctx,
  type Vars,
  type Visibility,
} from "../middleware";
import { newId } from "../lib/ids";
import { rateLimit } from "../lib/rate";

/* ---------------------------------------------------------------------------
 * Enums mirror the CHECK constraints in migrations/0001_init.sql. They are
 * repeated here so a bad value is a 400 with a field name on it rather than a
 * D1 constraint error. If the two ever disagree the schema wins.
 * ------------------------------------------------------------------------- */
const VISIBILITIES = ["private", "unlisted", "password", "public"] as const;
const TAGS = ["invoicing", "booking", "inventory", "internal", "other"] as const;
const STATUSES = ["live", "down", "draft"] as const;
const BUILDERS = [
  "pages",
  "lovable",
  "replit",
  "v0",
  "bolt",
  "claude",
  "other",
] as const;

type Tag = (typeof TAGS)[number];
type Status = (typeof STATUSES)[number];
type Builder = (typeof BUILDERS)[number];

const MAX = {
  title: 120,
  blurb: 280,
  section: 60,
  prompt: 20_000,
  url: 2048,
  id: 64,
} as const;

/**
 * Version notes are capped by the API, not by the schema. The snapshot route
 * does that write and lives in another file, so the number lives here where
 * the rest of the tool validation is and both ends can agree on one value.
 */
export const VERSION_NOTE_MAX = 80;

const MAX_SHOT_BYTES = 2 * 1024 * 1024;
const MAX_REORDER = 500;

type ToolRow = {
  id: string;
  shelf_id: string;
  title: string;
  blurb: string | null;
  live_url: string;
  screenshot_key: string | null;
  section: string | null;
  tag: Tag | null;
  visibility: Visibility;
  sort_order: number;
  version: number;
  status: Status;
  checked_at: number | null;
  confirmed_at: number | null;
  stack: string | null;
  prompt: string | null;
  builder: Builder | null;
  builder_url: string | null;
  created_at: number;
  updated_at: number;
};

type ShelfRow = {
  id: string;
  user_id: string;
  slug: string;
  visibility: Visibility;
};

/* ---------------------------------------------------------------------------
 * Input.
 * ------------------------------------------------------------------------- */

const bad = (message: string) => new HTTPException(400, { message });
const notFound = () => new HTTPException(404, { message: "not_found" });

async function jsonBody(c: Ctx): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw bad("invalid_body");
  }
  return body as Record<string, unknown>;
}

/**
 * undefined means the caller did not mention the field, null means they sent
 * it empty. PATCH needs to tell those apart: one leaves the column alone, the
 * other clears it.
 */
function text(
  body: Record<string, unknown>,
  key: string,
  max: number
): string | null | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw bad(`${key}_invalid`);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw bad(`${key}_too_long`);
  return trimmed;
}

function enumValue<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | null | undefined {
  const value = text(body, key, 40);
  if (value === undefined || value === null) return value;
  if (!(allowed as readonly string[]).includes(value)) throw bad(`${key}_invalid`);
  return value as T;
}

function integer(body: Record<string, unknown>, key: string): number | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw bad(`${key}_invalid`);
  return Math.trunc(raw);
}

/**
 * An allowlist of schemes, not a denylist of bad ones. javascript: and data:
 * are the two everyone names, but this URL ends up in an anchor the client
 * clicks, so anything that is not plain web navigation stays out.
 */
function parseWebUrl(value: string, key: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw bad(`${key}_invalid`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw bad(`${key}_scheme`);
  }
  return url;
}

const SECRET_PARAM_WORDS = new Set([
  "key",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "auth",
  "credential",
  "credentials",
]);

/**
 * Warn, do not block. A builder hands you a share link with a token in the
 * query string often enough that refusing it would just teach people to work
 * around the field, and this URL is about to be pasted into a client email.
 *
 * Splitting the parameter name into words before matching keeps "monkey" and
 * "keynote" from tripping it, while api_key, access-token and apiKey all land.
 */
function looksLikeSecret(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // Credentials in the userinfo half are a credential by definition.
  if (url.username || url.password) return true;
  for (const name of url.searchParams.keys()) {
    const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some((word) => SECRET_PARAM_WORDS.has(word))) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------
 * Output.
 * ------------------------------------------------------------------------- */

/**
 * The OWNER payload. Fields are named one by one so a column added to the
 * table later cannot start appearing in responses by itself.
 *
 * This is not the client-facing shape and must never be turned into one by
 * deleting keys. prompt, builder_url and shelf_id all live here, and none of
 * them may reach a stranger. The /s/:slug serialiser is its own, much shorter
 * allowlist, written from scratch.
 */
function ownerTool(t: ToolRow) {
  return {
    id: t.id,
    shelf_id: t.shelf_id,
    title: t.title,
    blurb: t.blurb,
    live_url: t.live_url,
    screenshot_key: t.screenshot_key,
    section: t.section,
    tag: t.tag,
    visibility: t.visibility,
    sort_order: t.sort_order,
    version: t.version,
    status: t.status,
    checked_at: t.checked_at,
    confirmed_at: t.confirmed_at,
    stack: t.stack,
    prompt: t.prompt,
    builder: t.builder,
    builder_url: t.builder_url,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

async function nextSortOrder(c: Ctx, shelfId: string): Promise<number> {
  const row = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tools WHERE shelf_id = ?"
  )
    .bind(shelfId)
    .first<{ next: number }>();
  return row?.next ?? 0;
}

/* ---------------------------------------------------------------------------
 * Routes. Mounted by the integrator at /api/tools.
 * ------------------------------------------------------------------------- */

export const tools = new Hono<{ Bindings: Env; Variables: Vars }>();

tools.use("*", requireAuth);

/**
 * POST /api/tools
 * Only title and live URL are required. Everything else is the drawer being
 * generous, and the whole point is that parking a tool takes thirty seconds.
 */
tools.post("/", async (c) => {
  const body = await jsonBody(c);

  const shelfId = text(body, "shelf_id", MAX.id);
  if (!shelfId) throw bad("shelf_id_required");
  const shelf = await ownedShelf<ShelfRow>(c, shelfId);

  const title = text(body, "title", MAX.title);
  if (!title) throw bad("title_required");

  const liveUrlRaw = text(body, "live_url", MAX.url);
  if (!liveUrlRaw) throw bad("live_url_required");
  const liveUrl = parseWebUrl(liveUrlRaw, "live_url").toString();

  const builderUrlRaw = text(body, "builder_url", MAX.url);
  const builderUrl = builderUrlRaw
    ? parseWebUrl(builderUrlRaw, "builder_url").toString()
    : null;

  const visibility = clampVisibility(
    enumValue(body, "visibility", VISIBILITIES) ?? "private",
    shelf.visibility
  );

  const now = Date.now();
  const row: ToolRow = {
    id: newId("tool"),
    shelf_id: shelf.id,
    title,
    blurb: text(body, "blurb", MAX.blurb) ?? null,
    live_url: liveUrl,
    screenshot_key: null,
    section: text(body, "section", MAX.section) ?? null,
    tag: enumValue(body, "tag", TAGS) ?? null,
    visibility,
    sort_order: integer(body, "sort_order") ?? (await nextSortOrder(c, shelf.id)),
    version: 1,
    status: enumValue(body, "status", STATUSES) ?? "live",
    checked_at: null,
    // A human just typed this URL in, so this moment is the last time anyone
    // asserted the tool is real. checked_at stays null: no machine has looked.
    confirmed_at: now,
    prompt: text(body, "prompt", MAX.prompt) ?? null,
    builder: enumValue(body, "builder", BUILDERS) ?? null,
    builder_url: builderUrl,
    stack: text(body, "stack", MAX.prompt) ?? null,
    created_at: now,
    updated_at: now,
  };

  await c.env.DB.prepare(
    `INSERT INTO tools
       (id, shelf_id, title, blurb, live_url, screenshot_key, section, tag,
        visibility, sort_order, version, status, checked_at, confirmed_at,
        stack, prompt, builder, builder_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.shelf_id,
      row.title,
      row.blurb,
      row.live_url,
      row.screenshot_key,
      row.section,
      row.tag,
      row.visibility,
      row.sort_order,
      row.version,
      row.status,
      row.checked_at,
      row.confirmed_at,
      row.stack,
      row.prompt,
      row.builder,
      row.builder_url,
      row.created_at,
      row.updated_at
    )
    .run();

  return c.json({ tool: ownerTool(row), secret_warning: looksLikeSecret(row.live_url) }, 201);
});

/**
 * POST /api/tools/reorder  { shelf_id, ids }
 * Registered before the :id routes so the literal path is unambiguous.
 */
tools.post("/reorder", async (c) => {
  const body = await jsonBody(c);

  const shelfId = text(body, "shelf_id", MAX.id);
  if (!shelfId) throw bad("shelf_id_required");
  const shelf = await ownedShelf<ShelfRow>(c, shelfId);

  const raw = body.ids;
  if (!Array.isArray(raw) || raw.length === 0) throw bad("ids_required");
  if (raw.length > MAX_REORDER) throw bad("ids_too_many");
  const ids = raw.map((value) => {
    if (typeof value !== "string" || !value) throw bad("ids_invalid");
    return value;
  });
  if (new Set(ids).size !== ids.length) throw bad("ids_duplicated");

  // Every id is checked against the shelf BEFORE a single row is written.
  // Checking as we go would let a list that turns bad halfway through leave
  // the shelf half-reordered, with no way for the client to know where it
  // stopped.
  const rows = await c.env.DB.prepare("SELECT id FROM tools WHERE shelf_id = ?")
    .bind(shelf.id)
    .all<{ id: string }>();
  const onShelf = new Set((rows.results ?? []).map((r) => r.id));

  // 404 for the same reason ownedTool gives one: an id that belongs to
  // somebody else and an id that never existed have to look identical.
  if (ids.some((id) => !onShelf.has(id))) throw notFound();

  const now = Date.now();
  const stmt = c.env.DB.prepare(
    "UPDATE tools SET sort_order = ?, updated_at = ? WHERE id = ? AND shelf_id = ?"
  );
  await c.env.DB.batch(ids.map((id, i) => stmt.bind(i, now, id, shelf.id)));

  return c.json({ ok: true, count: ids.length });
});

/**
 * PATCH /api/tools/:id
 * Partial. A field absent from the body is left alone, a field sent empty is
 * cleared. title and live_url cannot be cleared: the columns are NOT NULL and
 * a card without either is not a card.
 */
tools.patch("/:id", async (c) => {
  const tool = await ownedTool<ToolRow>(c, c.req.param("id"));
  const shelf = await ownedShelf<ShelfRow>(c, tool.shelf_id);
  const body = await jsonBody(c);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  // live_url, status and prompt are assertions about the world rather than
  // presentation, so touching any of them is a human saying the card is still
  // true and re-dates confirmed_at.
  let reconfirm = false;
  let effectiveLiveUrl = tool.live_url;

  const title = text(body, "title", MAX.title);
  if (title !== undefined) {
    if (title === null) throw bad("title_required");
    set("title", title);
  }

  const liveUrlRaw = text(body, "live_url", MAX.url);
  if (liveUrlRaw !== undefined) {
    if (liveUrlRaw === null) throw bad("live_url_required");
    effectiveLiveUrl = parseWebUrl(liveUrlRaw, "live_url").toString();
    set("live_url", effectiveLiveUrl);
    reconfirm = true;
  }

  const status = enumValue(body, "status", STATUSES);
  if (status !== undefined) {
    if (status === null) throw bad("status_invalid");
    set("status", status);
    reconfirm = true;
  }

  if ("stack" in body) set("stack", text(body, "stack", MAX.prompt));
  if ("prompt" in body) {
    set("prompt", text(body, "prompt", MAX.prompt));
    reconfirm = true;
  }

  if ("blurb" in body) set("blurb", text(body, "blurb", MAX.blurb));
  if ("section" in body) set("section", text(body, "section", MAX.section));
  if ("tag" in body) set("tag", enumValue(body, "tag", TAGS));
  if ("builder" in body) set("builder", enumValue(body, "builder", BUILDERS));

  if ("builder_url" in body) {
    const raw = text(body, "builder_url", MAX.url);
    set("builder_url", raw ? parseWebUrl(raw, "builder_url").toString() : null);
  }

  const sortOrder = integer(body, "sort_order");
  if (sortOrder !== undefined) set("sort_order", sortOrder);

  const requestedVisibility = enumValue(body, "visibility", VISIBILITIES);
  if (requestedVisibility === null) throw bad("visibility_invalid");
  // Rewritten on every PATCH, not only when the body carries it. If the parent
  // shelf was narrowed after this tool was saved, the row is still holding the
  // wider value, and every write is a chance to pull it back down.
  set(
    "visibility",
    clampVisibility(requestedVisibility ?? tool.visibility, shelf.visibility)
  );

  const now = Date.now();
  if (reconfirm) set("confirmed_at", now);
  set("updated_at", now);

  binds.push(tool.id);
  await c.env.DB.prepare(`UPDATE tools SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  const updated = await ownedTool<ToolRow>(c, tool.id);
  return c.json({
    tool: ownerTool(updated),
    secret_warning: looksLikeSecret(effectiveLiveUrl),
  });
});

tools.delete("/:id", async (c) => {
  const tool = await ownedTool<ToolRow>(c, c.req.param("id"));

  await c.env.DB.prepare("DELETE FROM tools WHERE id = ?").bind(tool.id).run();

  // Best effort, and after the row is gone: a stranded object costs storage,
  // a failed delete that blocks the request costs the user their action.
  // Snapshot-frozen shots live under their own keys and are not ours to sweep.
  if (tool.screenshot_key) {
    await c.env.FILES.delete(tool.screenshot_key).catch(() => {});
  }

  return c.json({ ok: true });
});

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/**
 * The filename and the multipart Content-Type are both written by whoever is
 * uploading and neither one says anything about what is in the bytes. Read the
 * header instead. png and jpg only, stored as uploaded, keyed on the real
 * extension.
 */
function sniffImage(bytes: Uint8Array): { ext: "png" | "jpg"; type: string } | null {
  const startsWith = (magic: number[]) =>
    bytes.byteLength >= magic.length && magic.every((b, i) => bytes[i] === b);
  if (startsWith(PNG_MAGIC)) return { ext: "png", type: "image/png" };
  if (startsWith(JPEG_MAGIC)) return { ext: "jpg", type: "image/jpeg" };
  return null;
}

/** POST /api/tools/:id/shot  multipart, field `file`. */
tools.post("/:id/shot", async (c) => {
  const tool = await ownedTool<ToolRow>(c, c.req.param("id"));

  // Authenticated, but still an unmetered write path into R2 if nobody counts.
  // Set generously enough that a real session never meets it.
  const limit = await rateLimit(c.env, `shot:${c.var.user.id}`, 60, 3600);
  if (!limit.ok) return c.json({ error: "rate_limited" }, 429);

  const form = await c.req.formData().catch(() => null);
  const entry =
    form?.get("file") ?? form?.get("shot") ?? form?.get("screenshot") ?? null;
  if (!entry || typeof entry === "string") throw bad("file_required");
  if (entry.size > MAX_SHOT_BYTES) return c.json({ error: "file_too_large" }, 413);

  const bytes = new Uint8Array(await entry.arrayBuffer());
  // Checked again after reading: the reported size is a claim about the part,
  // the buffer is the thing about to be stored.
  if (bytes.byteLength > MAX_SHOT_BYTES) {
    return c.json({ error: "file_too_large" }, 413);
  }

  const kind = sniffImage(bytes);
  if (!kind) return c.json({ error: "unsupported_type" }, 415);

  const key = `shots/${c.var.user.id}/${tool.id}.${kind.ext}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: kind.type } });

  // A png replacing a jpg lands on a different key, so the previous object
  // would sit there forever and, worse, still be servable.
  if (tool.screenshot_key && tool.screenshot_key !== key) {
    await c.env.FILES.delete(tool.screenshot_key).catch(() => {});
  }

  await c.env.DB.prepare(
    "UPDATE tools SET screenshot_key = ?, updated_at = ? WHERE id = ?"
  )
    .bind(key, Date.now(), tool.id)
    .run();

  const updated = await ownedTool<ToolRow>(c, tool.id);
  return c.json({ ok: true, tool: ownerTool(updated) });
});

/* ---------------------------------------------------------------------------
 * File serving.
 * ------------------------------------------------------------------------- */

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/**
 * Streams one R2 object. The caller decides the key and therefore owns the
 * access decision: this helper is used from the owner routes and from the
 * public shelf, and it has no idea which. It answers 404 for a missing object
 * so a probe cannot tell an unauthorised key from an absent one.
 */
export async function serveFile(c: Ctx, key: string): Promise<Response> {
  const object = await c.env.FILES.get(key, { onlyIf: c.req.raw.headers });
  if (!object) return c.json({ error: "not_found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (!headers.get("content-type")) {
    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    headers.set("content-type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  }
  // The stored type is whatever the upload route set after sniffing the bytes.
  // nosniff stops a browser from second-guessing that on a file a stranger
  // handed us.
  headers.set("x-content-type-options", "nosniff");
  // Screenshot keys are stable across re-uploads, so this can never be
  // immutable: a replaced screenshot has to win before the cache outlives the
  // client's interest in the page.
  headers.set("cache-control", "public, max-age=300");

  // R2 hands back a bodyless object when the caller's precondition says their
  // copy is already current.
  const body = "body" in object ? object.body : null;
  if (!body) return new Response(null, { status: 304, headers });

  return new Response(body, { headers });
}
