import type { Env } from "../types";
import { newToken } from "./ids";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const SESSION_COOKIE = "shelf_session";

export type SessionData = { userId: string; createdAt: number };

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = newToken();
  const data: SessionData = { userId, createdAt: Date.now() };
  await env.KV.put(`session:${token}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function readSession(
  env: Env,
  token: string | undefined
): Promise<SessionData | null> {
  if (!token) return null;
  const raw = await env.KV.get(`session:${token}`);
  return raw ? (JSON.parse(raw) as SessionData) : null;
}

export const destroySession = (env: Env, token: string) =>
  env.KV.delete(`session:${token}`);

/**
 * HttpOnly so script cannot read it, SameSite=Lax so the magic-link
 * navigation from an email client still carries it, Secure everywhere
 * except localhost.
 */
export function sessionCookie(token: string, url: URL): string {
  const secure = url.hostname === "localhost" ? "" : " Secure;";
  return `${SESSION_COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearCookie(url: URL): string {
  const secure = url.hostname === "localhost" ? "" : " Secure;";
  return `${SESSION_COOKIE}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`;
}
