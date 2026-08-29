import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { requireAuth, type Vars } from "./middleware";
import { auth } from "./routes/auth";
import { shelves } from "./routes/shelves";
import { tools } from "./routes/tools";
import { publicShelf } from "./routes/publicShelf";
import { versions } from "./routes/versions";
import { livecheck, runScheduledCheck } from "./routes/livecheck";
import { files } from "./routes/files";

// One Worker serves the API and the built SPA. `run_worker_first` in
// wrangler.jsonc routes /api/* here; everything else is served from assets
// with an index.html fallback. Do not split these into two Workers.
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.route("/api/auth", auth);
app.route("/api/shelves", shelves);
app.route("/api/tools", tools);
app.route("/api/tools", versions);   // /:id/versions, /:id/snapshot, /:id/make-live, /:id/confirm
app.route("/api/tools", livecheck);  // /:id/ping

// No session anywhere under here. Every response is built by an explicit
// allowlist, and a private shelf is indistinguishable from one that does not
// exist. See publicShelf.ts.
app.route("/api/s", publicShelf);
app.route("/api/files", files);

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
    checks.r2 = (await c.env.FILES.get("health.txt")) ? "ok" : "FAILED: read back empty";
    await c.env.FILES.delete("health.txt");
  } catch (err) {
    checks.r2 = `FAILED: ${(err as Error).message}`;
  }
  const healthy = Object.values(checks).every((v) => v.startsWith("ok"));
  return c.json({ healthy, checks }, healthy ? 200 : 503);
});

// The only route that tells the client who it is. Public payload shape:
// never widen this to spread the whole user row.
app.get("/api/me", requireAuth, (c) => {
  const u = c.var.user;
  return c.json({ user: { handle: u.handle, name: u.name, plan: u.plan } });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("unhandled:", err);
  return c.json({ error: "internal" }, 500);
});

// Unknown API routes must not fall through to index.html.
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Defensive: with run_worker_first only /api/* reaches the Worker, but if
// that config ever changes, serve the SPA rather than 404ing the site.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledCheck(env).then(({ checked, down }) =>
        console.log(`live check: ${checked} checked, ${down} down`)
      )
    );
  },
} satisfies ExportedHandler<Env>;
