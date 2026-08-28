export type Me = { handle: string; name: string; plan: "free" | "studio" };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => req<{ user: Me }>("/api/me"),
  sendMagicLink: (email: string) =>
    req<{ ok: true }>("/api/auth/magic", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),
};
