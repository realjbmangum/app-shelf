import type { Env } from "../types";
import { newId } from "./ids";

export type User = {
  id: string;
  handle: string;
  name: string;
  email: string;
  plan: "free" | "studio";
  created_at: number;
};

export const findUserByEmail = (env: Env, email: string) =>
  env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<User>();

export const findUserById = (env: Env, id: string) =>
  env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();

/**
 * Handle from the email local-part: lowercased, non-alphanumerics collapsed
 * to hyphens, 20 chars, numeric suffix on collision. Never derived from
 * anything the user has not already given us.
 */
async function uniqueHandle(env: Env, email: string): Promise<string> {
  const base =
    (email.split("@")[0] ?? "user")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "user";

  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n}`;
    const taken = await env.DB.prepare("SELECT 1 FROM users WHERE handle = ?")
      .bind(candidate)
      .first();
    if (!taken) return candidate;
  }
  return `${base}-${newId("x").slice(-6).toLowerCase()}`;
}

/** First login creates the account. There is no separate signup. */
export async function findOrCreateUser(env: Env, email: string): Promise<User> {
  const normalized = email.toLowerCase().trim();
  const existing = await findUserByEmail(env, normalized);
  if (existing) return existing;

  const user: User = {
    id: newId("usr"),
    handle: await uniqueHandle(env, normalized),
    name: normalized.split("@")[0] ?? "there",
    email: normalized,
    plan: "free",
    created_at: Date.now(),
  };

  await env.DB.prepare(
    "INSERT INTO users (id, handle, name, email, plan, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(user.id, user.handle, user.name, user.email, user.plan, user.created_at)
    .run();

  return user;
}
