import { Hono } from "hono";
import type { Env } from "./types";

// One Worker serves the API and the built SPA. `run_worker_first` in
// wrangler.jsonc routes /api/* here; everything else is served from assets
// with an index.html fallback. Do not split these into two Workers.
const app = new Hono<{ Bindings: Env }>();

// Proves the scaffold: every binding is reachable and the schema is applied.
app.get("/api/health", async (c) => {
  const checks: Record<string, string> = {};

  try {
    const row = await c.env.DB.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'"
    ).first<{ n: number }>();
    checks.d1 = `ok, ${row?.n ?? 0} tables`;
  } catch (err) {
    checks.d1 = `FAILED: ${(err as Error).message}`;
  }

  try {
    await c.env.KV.put("health", String(Date.now()), { expirationTtl: 60 });
    checks.kv = (await c.env.KV.get("health")) ? "ok" : "FAILED: read back empty";
  } catch (err) {
    checks.kv = `FAILED: ${(err as Error).message}`;
  }

  try {
    await c.env.FILES.put("health.txt", "ok");
    const obj = await c.env.FILES.get("health.txt");
    checks.r2 = obj ? "ok" : "FAILED: read back empty";
    await c.env.FILES.delete("health.txt");
  } catch (err) {
    checks.r2 = `FAILED: ${(err as Error).message}`;
  }

  const healthy = Object.values(checks).every((v) => v.startsWith("ok"));
  return c.json({ healthy, checks }, healthy ? 200 : 503);
});

// Slice 1 replaces this with a real session lookup.
app.get("/api/me", (c) => c.json({ user: null }, 401));

// Unknown API routes must not fall through to index.html.
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Defensive: with run_worker_first only /api/* reaches the Worker, but if
// that config ever changes, serve the SPA rather than 404ing the site.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  // Slice 5. Declared now because the cron trigger is the reason this
  // project is a Worker and not Pages.
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    console.log("live check: not implemented until slice 5");
  },
} satisfies ExportedHandler<Env>;
