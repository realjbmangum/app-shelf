# Shelf

Where an agency parks every tool it built for a client, on one link the client can use.

## Status

Slice 0 complete: scaffold only, no product yet. Next is slice 1, magic link auth.

## Run it

```bash
npm install
npm run db:reset     # apply migration + seed, local D1
npm run preview      # build, then wrangler dev on :8787
```

`npm run preview` is the one that serves the API and the app together, which
is how it runs in production. `npm run dev` is Vite alone and proxies `/api`
to :8787, so it needs `wrangler dev` running beside it.

`GET /api/health` checks D1, KV and R2 and is the fastest way to tell whether
the scaffold is wired.

## Deploy

```bash
npm run deploy
```

Migrations are applied separately and deliberately:

```bash
npm run db:remote ./migrations/0001_init.sql
```

Never seed the remote database. The seed is dev fixtures.

## Layout

| Path | What |
|---|---|
| `worker/` | Hono API and the scheduled live check. Runs on `/api/*`. |
| `src/` | React SPA, served as static assets by the same Worker. |
| `migrations/` | D1 schema. `0001_init.sql` is the whole model. |
| `seed/` | Dev fixtures. Re-runnable. |
| `design/` | Seven screen artboards. Source for the canvas below. |

Frontend and API are **one deployable on purpose**. Do not split them.

## Docs

| File | What it is |
|---|---|
| `SHELF-PRD.html` | The spec. Open it in a browser. Read it before writing code. |
| `SHELF-VALIDATION.html` | Market validation and the review behind the agency-first shape. |
| `SHELF_HANDOFF.md` | The original brief. Provenance only, do not build from it. |
| `CLAUDE.md` | The decisions that are expensive to reverse. |

Design canvas: https://claude.ai/code/artifact/dbb4cf43-d929-45cd-90c2-f352abc1ab08

`design/shelf-v1-screens.html` is generated from `design/*.dc.html` and is
gitignored. If the canvas has been edited in the browser, read the published
page back before regenerating or those edits are lost.

## Known gaps

- `public/fonts/*.woff2` are not in the repo, so Fraunces and IBM Plex Sans
  fall back to Georgia and system-ui. The `@font-face` rules are in place.
  Self-hosted on purpose: a client shelf must not phone a third party.
- `SENDGRID_API_KEY` is unset. Copy `.dev.vars.example` to `.dev.vars` for
  slice 1. Production uses `wrangler secret put`.
