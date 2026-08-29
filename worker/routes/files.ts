import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../types";
import { readSession, SESSION_COOKIE } from "../lib/session";
import { serveFile } from "./tools";
import type { Ctx } from "../middleware";

/**
 * Screenshots and logos out of R2.
 *
 * There is no session requirement here, because a client opening a shelf
 * link has no account. That makes this an authorisation decision, not an
 * authentication one, and getting it wrong leaks the screenshot of a private
 * tool to anyone who can guess a key.
 *
 * The rule mirrors publicShelf.ts exactly: a file is public only when the
 * row that references it is itself public. We never trust the key's shape,
 * we look up the row that owns it. An unreferenced key is a 404, so a
 * deleted tool's screenshot stops being fetchable immediately.
 */
export const files = new Hono<{ Bindings: Env }>();

type Owned = { owner_id: string; tool_vis: string | null; shelf_vis: string };

files.get("/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/files\//, "");
  if (!key || key.includes("..")) return c.notFound();

  // Which row claims this key, and how visible is it? A snapshot screenshot
  // inherits its tool's current visibility rather than the visibility the
  // tool had when the version was frozen: the owner's intent is the current
  // one, and the alternative silently republishes something they hid.
  const row =
    (await c.env.DB.prepare(
      `SELECT s.user_id AS owner_id, t.visibility AS tool_vis, s.visibility AS shelf_vis
         FROM tools t JOIN shelves s ON s.id = t.shelf_id
        WHERE t.screenshot_key = ?
        UNION ALL
       SELECT s.user_id, NULL, s.visibility
         FROM shelves s WHERE s.logo_key = ?
        LIMIT 1`
    )
      .bind(key, key)
      .first<Owned>()) ?? null;

  if (!row) return c.notFound();

  const isPublic =
    row.shelf_vis !== "private" && (row.tool_vis === null || row.tool_vis !== "private");

  if (!isPublic) {
    // Fall back to the owner. Anyone else gets the same 404 a missing file
    // gets, so the response never confirms that a hidden file exists.
    const session = await readSession(c.env, getCookie(c, SESSION_COOKIE));
    if (!session || session.userId !== row.owner_id) return c.notFound();
  }

  return serveFile(c as unknown as Ctx, key);
});
