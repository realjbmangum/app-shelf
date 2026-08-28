import { ulid } from "ulid";

// ULIDs: lexicographically sortable by creation time, so `ORDER BY id`
// is chronological and we never need a separate sequence column.
export const newId = (prefix: string) => `${prefix}_${ulid()}`;

/** 32 bytes of CSPRNG as base64url. Used for magic-link and session tokens. */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Constant-time string compare. Token lookups go through KV by key so this
 * is belt-and-braces, but any place we compare a secret uses it.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
