import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../types";
import type { Vars } from "../middleware";
import { newToken } from "../lib/ids";
import { rateLimit, clientIp } from "../lib/rate";
import { findOrCreateUser } from "../lib/db";
import {
  createSession,
  destroySession,
  sessionCookie,
  clearCookie,
  SESSION_COOKIE,
} from "../lib/session";
import { sendMagicLink } from "../lib/email";

const MAGIC_TTL_SECONDS = 15 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * POST /api/auth/magic  { email }
 *
 * Always returns the same 200 regardless of whether the address is known.
 * Revealing "no such account" turns this into an account-existence oracle.
 */
auth.post("/magic", async (c) => {
  const ip = clientIp(c.req.raw);
  const ipLimit = await rateLimit(c.env, `magic:ip:${ip}`, 10, 3600);
  if (!ipLimit.ok) return c.json({ error: "rate_limited" }, 429);

  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = (body.email ?? "").trim().toLowerCase();

  const sameResponse = c.json({ ok: true });
  if (!EMAIL_RE.test(email) || email.length > 254) return sameResponse;

  const emailLimit = await rateLimit(c.env, `magic:email:${email}`, 5, 3600);
  if (!emailLimit.ok) return sameResponse;

  const token = newToken();
  await c.env.KV.put(`magic:${token}`, email, { expirationTtl: MAGIC_TTL_SECONDS });

  const url = new URL(c.req.url);
  const link = `${url.origin}/api/auth/callback?token=${token}`;
  const isProduction = url.hostname !== "localhost" && url.hostname !== "127.0.0.1";

  try {
    await sendMagicLink(c.env, email, link, isProduction);
  } catch (err) {
    console.error("magic link send failed:", (err as Error).message);
    return c.json({ error: "send_failed" }, 500);
  }

  return sameResponse;
});

/**
 * GET /api/auth/callback?token=...
 * Single use: the token is deleted before the session is issued, so a
 * replayed link cannot mint a second session.
 */
auth.get("/callback", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.redirect("/login?error=invalid", 302);

  const email = await c.env.KV.get(`magic:${token}`);
  if (!email) return c.redirect("/login?error=expired", 302);
  await c.env.KV.delete(`magic:${token}`);

  const user = await findOrCreateUser(c.env, email);
  const session = await createSession(c.env, user.id);

  c.header("Set-Cookie", sessionCookie(session, new URL(c.req.url)));
  return c.redirect("/app", 302);
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env, token);
  c.header("Set-Cookie", clearCookie(new URL(c.req.url)));
  return c.json({ ok: true });
});
