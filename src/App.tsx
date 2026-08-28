import { useEffect, useState } from "react";

type Health = { healthy: boolean; checks: Record<string, string> };

/**
 * Slice 0 only. This screen exists to prove the scaffold is wired: one
 * deployable, D1 + KV + R2 all reachable, schema applied. Slice 1 replaces
 * it with the real login.
 */
export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-7">
      <div className="flex flex-col items-start gap-2">
        <h1 className="font-display text-4xl font-medium tracking-tight">Shelf</h1>
        <div className="w-36 shelf-edge" />
      </div>

      <p className="text-muted">
        Scaffold only. No product yet. This page checks that the Worker, the
        database, the file store and the session store are all reachable from
        one deployable.
      </p>

      <div className="rounded-md border border-line bg-card p-5">
        <div className="mb-3 text-xs uppercase tracking-[0.07em] text-muted">
          Bindings
        </div>

        {error && <div className="text-sm text-rust">Request failed: {error}</div>}
        {!health && !error && <div className="text-sm text-muted">Checking...</div>}

        {health && (
          <ul className="flex flex-col gap-2">
            {Object.entries(health.checks).map(([name, result]) => {
              const ok = result.startsWith("ok");
              return (
                <li key={name} className="flex items-baseline gap-3 text-sm">
                  <span
                    className="size-[7px] shrink-0 translate-y-[-1px] rounded-full"
                    style={{ background: ok ? "var(--moss)" : "var(--rust)" }}
                  />
                  <span className="w-8 uppercase tracking-[0.07em] text-muted text-xs">
                    {name}
                  </span>
                  <span className={ok ? "text-ink" : "text-rust"}>{result}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-sm text-muted">
        Next: slice 1, magic link auth.
      </p>
    </main>
  );
}
