import type { Env } from "../types";

/**
 * Fixed-window counter in KV. Not exact under concurrency, which is fine:
 * this exists to stop someone pumping the magic-link endpoint, not to meter
 * billing. Cloudflare's Rate Limiting binding is the precise option and is
 * one of the features Pages cannot offer, which is part of why this project
 * is a Worker.
 */
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: boolean; remaining: number }> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const k = `rate:${key}:${bucket}`;
  const current = Number((await env.KV.get(k)) ?? 0);

  if (current >= limit) return { ok: false, remaining: 0 };

  await env.KV.put(k, String(current + 1), { expirationTtl: windowSeconds + 60 });
  return { ok: true, remaining: limit - current - 1 };
}

/** Best-effort client IP. Cloudflare sets CF-Connecting-IP at the edge. */
export const clientIp = (req: Request) =>
  req.headers.get("CF-Connecting-IP") ?? "unknown";
