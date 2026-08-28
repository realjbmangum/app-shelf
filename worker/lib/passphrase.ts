import { timingSafeEqual } from "./ids";

/**
 * The ONE implementation of shelf passphrase hashing.
 *
 * It lives here because it did not, once. shelves.ts wrote
 * `pbkdf2$<iters>$<salt>$<digest>` and publicShelf.ts read
 * `pbkdf2$sha256$<iters>$<salt>$<key>`, so a correct passphrase could never
 * open a gated shelf, and the mismatch was swallowed by a length guard
 * before the error log could fire. Whoever writes the hash and whoever
 * checks it must import the same function. Do not re-implement either half.
 *
 * Envelope: pbkdf2$sha256$<iterations>$<salt b64url>$<key b64url>
 * Self-describing on purpose: the cost travels with the hash, so raising
 * PBKDF2_ITERATIONS later leaves existing rows verifiable.
 */
const PBKDF2_ITERATIONS = 210_000; // OWASP floor for PBKDF2-SHA256
const PBKDF2_KEY_BITS = 256;
const PBKDF2_MIN_ITERATIONS = 10_000;
const PBKDF2_MAX_ITERATIONS = 2_000_000;

export const PASSPHRASE_MIN = 6;
export const PASSPHRASE_MAX = 200;

const toB64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function fromB64url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

async function derive(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    PBKDF2_KEY_BITS
  );
  return toB64url(bits);
}

/**
 * Trimmed on both sides. The owner emails the word, the client pastes it with
 * a trailing space, and being locked out by whitespace is indistinguishable
 * from the product being broken.
 */
export async function hashPassphrase(raw: string): Promise<string> {
  const passphrase = raw.trim();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(passphrase, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toB64url(salt.buffer as ArrayBuffer)}$${digest}`;
}

export async function verifyPassphrase(
  stored: string | null | undefined,
  supplied: unknown
): Promise<boolean> {
  if (!stored || typeof supplied !== "string") return false;
  try {
    const parts = stored.split("$");
    if (parts.length !== 5) return false;
    const [scheme, hash, iterationText, saltText, expected] = parts;
    if (scheme !== "pbkdf2" || hash !== "sha256") return false;

    const iterations = Number(iterationText);
    if (
      !Number.isInteger(iterations) ||
      iterations < PBKDF2_MIN_ITERATIONS ||
      iterations > PBKDF2_MAX_ITERATIONS
    ) {
      return false;
    }

    const candidate = await derive(supplied.trim(), fromB64url(saltText), iterations);
    return timingSafeEqual(candidate, expected);
  } catch (err) {
    console.error("passphrase envelope unreadable:", (err as Error).message);
    return false;
  }
}
