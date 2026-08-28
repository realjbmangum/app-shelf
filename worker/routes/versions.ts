import { Hono } from "hono";
import type { Env } from "../types";
import { ownedTool, requireAuth, type Vars } from "../middleware";
import { newId } from "../lib/ids";

/* ---------------------------------------------------------------------------
 * Versions: the product's memory.
 *
 * A snapshot freezes what a tool looked like BEFORE a change, so the sequence
 * a caller runs is snapshot, then patch. Nothing in here edits a tool's title,
 * visibility or status; /snapshot only reads the tool, and /make-live writes
 * back exactly what a snapshot already holds.
 *
 * Every route is owner-only and resolves its :id through ownedTool, which
 * throws 404 and never 403. Mounted by the integrator; expected prefix
 * /api/tools.
 * ------------------------------------------------------------------------- */

const NOTE_MAX = 80;
const DEFAULT_NOTE = "Updated link";

type ToolRow = {
  id: string;
  shelf_id: string;
  live_url: string;
  screenshot_key: string | null;
  prompt: string | null;
  version: number;
  confirmed_at: number | null;
};

type SnapshotRow = {
  id: string;
  version: number;
  live_url: string | null;
  screenshot_key: string | null;
  prompt: string | null;
  note: string | null;
  created_at: number;
};

export const versions = new Hono<{ Bindings: Env; Variables: Vars }>();

versions.use("*", requireAuth);

/**
 * A long note is trimmed rather than rejected. Failing the request would drop
 * the version itself, which is the one thing this table exists to prevent, and
 * the cap is a display constraint, not a correctness one.
 */
function cleanNote(raw: unknown): string {
  const note = typeof raw === "string" ? raw.trim() : "";
  return (note || DEFAULT_NOTE).slice(0, NOTE_MAX);
}

/**
 * snapshots carries UNIQUE(tool_id, version). Two snapshot calls racing on one
 * tool read the same current version, so the loser's insert fails here. That
 * is a conflict the caller can retry, not a 500.
 */
function isDuplicateVersion(err: unknown): boolean {
  const e = err as { message?: string; cause?: { message?: string } };
  const text = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return /unique constraint failed/i.test(text);
}

/**
 * GET /:id/versions
 *
 * live_version is the newest frozen version holding the URL the tool is
 * serving right now, or null when the tool has moved past all of them. It is
 * not tools.version: after a make-live the counter keeps climbing while the
 * live link is an older one, and the list has to mark the link that is
 * actually up.
 */
versions.get("/:id/versions", async (c) => {
  const tool = await ownedTool<ToolRow>(c, c.req.param("id"));

  // Columns are named even on an owner-only route, so a column added to
  // snapshots later is never shipped by accident.
  const { results } = await c.env.DB.prepare(
    `SELECT id, version, live_url, screenshot_key, prompt, note, created_at
       FROM snapshots
      WHERE tool_id = ?
      ORDER BY version DESC`
  )
    .bind(tool.id)
    .all<SnapshotRow>();

  const live = results.find((s) => s.live_url === tool.live_url);

  return c.json({
    current_version: tool.version,
    live_version: live?.version ?? null,
    versions: results,
  });
});

/**
 * POST /:id/snapshot  { note? }
 *
 * Freezes the tool's current live_url, prompt and screenshot_key at the
 * version number it is sitting on, then moves the tool to the next number.
 */
versions.post("/:id/snapshot", async (c) => {
  const tool = await ownedTool<ToolRow>(c, c.req.param("id"));
  const body = await c.req
    .json<{ note?: string }>()
    .catch(() => ({}) as { note?: string });

  const snapshot: SnapshotRow = {
    id: newId("snp"),
    version: tool.version,
    live_url: tool.live_url,
    screenshot_key: tool.screenshot_key,
    prompt: tool.prompt,
    note: cleanNote(body.note),
    created_at: Date.now(),
  };

  try {
    // One batch, so the freeze and the bump land together. A snapshot without
    // the bump would leave the tool on a version number that is already
    // frozen, and the next snapshot could never be written.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO snapshots
           (id, tool_id, version, live_url, screenshot_key, prompt, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        snapshot.id,
        tool.id,
        snapshot.version,
        snapshot.live_url,
        snapshot.screenshot_key,
        snapshot.prompt,
        snapshot.note,
        snapshot.created_at
      ),
      // version + 1 computed in SQL, not from the row we read, so a concurrent
      // writer is never rolled backwards by a stale number.
      c.env.DB.prepare(
        "UPDATE tools SET version = version + 1, updated_at = ? WHERE id = ?"
      ).bind(snapshot.created_at, tool.id),
    ]);
  } catch (err) {
    if (isDuplicateVersion(err)) return c.json({ error: "version_exists" }, 409);
    throw err;
  }

  // confirmed_at is deliberately untouched. This call records the state before
  // a change; the patch that follows is the edit, and that is what re-dates
  // confirmation.
  return c.json(
    { ok: true, snapshot, current_version: snapshot.version + 1 },
    201
  );
});

/**
 * POST /:id/make-live  { version }
 *
 * Puts an old link back up. It does not snapshot first: if the URL being
 * replaced is worth keeping, the caller posts /snapshot before this.
 */
versions.post("/:id/make-live", async (c) => {
  const tool = await ownedTool<ToolRow>(c, c.req.param("id"));
  const body = await c.req
    .json<{ version?: unknown }>()
    .catch(() => ({}) as { version?: unknown });

  const wanted = Number(body.version);
  if (!Number.isInteger(wanted) || wanted < 1) {
    return c.json({ error: "invalid_version" }, 400);
  }

  const snapshot = await c.env.DB.prepare(
    "SELECT id, version, live_url, prompt FROM snapshots WHERE tool_id = ? AND version = ?"
  )
    .bind(tool.id, wanted)
    .first<Pick<SnapshotRow, "id" | "version" | "live_url" | "prompt">>();

  // Scoped to this tool, so a version number belonging to someone else's tool
  // reads as a version that does not exist. Same 404 as an unowned tool.
  if (!snapshot) return c.json({ error: "not_found" }, 404);

  // snapshots.live_url is nullable and tools.live_url is NOT NULL, so a
  // snapshot frozen without a link cannot be restored onto the tool.
  if (!snapshot.live_url) return c.json({ error: "no_live_url" }, 400);

  const now = Date.now();

  // screenshot_key is left alone: the frozen shot lives at its own R2 key and
  // restoring it means copying the object, not moving a string.
  //
  // confirmed_at is refreshed because a human just said this is the link that
  // is true, which is exactly what that column records.
  await c.env.DB.prepare(
    "UPDATE tools SET live_url = ?, prompt = ?, confirmed_at = ?, updated_at = ? WHERE id = ?"
  )
    .bind(snapshot.live_url, snapshot.prompt, now, now, tool.id)
    .run();

  return c.json({
    ok: true,
    version: snapshot.version,
    live_url: snapshot.live_url,
    confirmed_at: now,
  });
});

/**
 * POST /:id/confirm
 *
 * Backs "Still true". A 200 from a machine is not evidence a tool is still in
 * use, so this is the only thing that re-dates a human confirmation on its own.
 */
versions.post("/:id/confirm", async (c) => {
  const tool = await ownedTool<ToolRow>(c, c.req.param("id"));
  const now = Date.now();

  // confirmed_at only. updated_at stays put: vouching for a tool is not an
  // edit, and bumping it would report work on the shelf list that nobody did.
  await c.env.DB.prepare("UPDATE tools SET confirmed_at = ? WHERE id = ?")
    .bind(now, tool.id)
    .run();

  return c.json({ ok: true, confirmed_at: now });
});
