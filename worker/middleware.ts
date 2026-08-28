import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { findUserById, type User } from "./lib/db";
import { readSession, SESSION_COOKIE } from "./lib/session";

export type Vars = { user: User };
export type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

/** 401 when there is no valid session. Sets c.var.user when there is. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> =
  async (c, next) => {
    const session = await readSession(c.env, getCookie(c, SESSION_COOKIE));
    if (!session) throw new HTTPException(401, { message: "not_authenticated" });

    const user = await findUserById(c.env, session.userId);
    if (!user) throw new HTTPException(401, { message: "not_authenticated" });

    c.set("user", user);
    await next();
  };

/* ---------------------------------------------------------------------------
 * OWNERSHIP. Non-negotiable #2.
 *
 * "Session required" is NOT the check. Every route that takes an :id must
 * resolve that id through the signed-in user's account before doing anything
 * with it. Skipping this is a plain IDOR: user A edits user B's tool.
 *
 * These throw 404, never 403. A 403 confirms the row exists, which tells an
 * attacker they found a real id and leaks that another account has it. From
 * outside, someone else's shelf is indistinguishable from one that was never
 * created.
 *
 * Use these helpers. Do not hand-roll the WHERE clause per route: the whole
 * point is that the check cannot be forgotten in one place.
 * ------------------------------------------------------------------------- */

const notFound = () => new HTTPException(404, { message: "not_found" });

export async function ownedShelf<T = Record<string, unknown>>(
  c: Ctx,
  shelfId: string
): Promise<T> {
  const row = await c.env.DB.prepare(
    "SELECT * FROM shelves WHERE id = ? AND user_id = ?"
  )
    .bind(shelfId, c.var.user.id)
    .first<T>();
  if (!row) throw notFound();
  return row;
}

/** Verified through the parent shelf, so a tool can never be reached sideways. */
export async function ownedTool<T = Record<string, unknown>>(
  c: Ctx,
  toolId: string
): Promise<T> {
  const row = await c.env.DB.prepare(
    `SELECT t.* FROM tools t
       JOIN shelves s ON s.id = t.shelf_id
      WHERE t.id = ? AND s.user_id = ?`
  )
    .bind(toolId, c.var.user.id)
    .first<T>();
  if (!row) throw notFound();
  return row;
}

/* ---------------------------------------------------------------------------
 * VISIBILITY CLAMP. Non-negotiable #5.
 * A tool cannot be more visible than the shelf it sits on. Enforced on write,
 * never in the UI alone.
 * ------------------------------------------------------------------------- */
const RANK = { private: 0, unlisted: 1, password: 1, public: 2 } as const;
export type Visibility = keyof typeof RANK;

export function clampVisibility(tool: Visibility, shelf: Visibility): Visibility {
  return RANK[tool] > RANK[shelf] ? shelf : tool;
}
