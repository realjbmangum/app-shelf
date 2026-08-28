# SHELF — Claude handoff

Read this whole file before writing code.
Build only what this file says.
If a feature is not in the build order, it does not exist yet.

Product working name: Shelf
One-line: A visual home for vibe-coded tools. No git. Cards, versions, links.

Builder constraints (JB Mangum):
- Cloudflare Pages + Workers + D1 + R2 + KV
- React or Astro + Tailwind + shadcn
- Git-pushed to Pages
- Edge-native. No long-running servers. No queues unless later specified.
- Fast MVP.

Audience:
- Business owners, freelancers, agencies who ship tiny tools with AI
- They hate git. UI must never say branch, commit, repo, pull, merge, diff, README.

---

## 0. What you are building vs what you are not

You ARE building:
- Auth
- A personal shelf of tool cards
- Public / unlisted / private pages
- Prompt pocket + version list (human notes, not git)
- Screenshot upload to R2
- Live/down check
- Client shelf (agency handoff) as v1.5 if v1 is solid

You are NOT building:
- An AI app generator
- Hosting of other people’s runtimes (no iframe IDE)
- Git hosting, diffs, CI
- Likes, comments, social feed, remix-of-code
- Teams permissions beyond owner + shared client shelf
- Custom domains in v1 (schema may reserve the column)

Competitor note for product decisions:
- Wabi = create + remix + social. Do not copy.
- Lovable / Replit / Pages = factories and hosts. Shelf is the shop window + memory.
- Notion / bookmarks = the thing we must beat on “find it Monday.”

---

## 1. Job to be done

Friday: ship a tool on Pages / Lovable / Replit.
Drop title, one sentence, live URL, screenshot, prompt on a card.
Monday: find it, read the old prompt, ship v2, flip live, send the same shelf link to a client.

If any step requires git knowledge, the product failed.

---

## 2. Personas and sample data

Use this seed data in local/dev and in screenshots.

Persona: Maria, bakery owner. Handle `maria`. Shelf slug `maria-bakery`.
Tools:
1. Standing order sheet — “Cafés text their Friday bread list. We stop guessing.” — booking — https://orders.maria.pages.dev
2. Cake calendar — “Custom cakes by date so the fridge is not a surprise.” — booking — https://cakes.maria.pages.dev
3. Wholesale invoices — “One page for café invoices. No QuickBooks tab.” — invoicing — https://invoices.maria.pages.dev
4. Flour run log — “Tracks vendor drops so we stop double-ordering rye.” — inventory — https://flour.maria.pages.dev

Second seed (optional): Dan landscaping. Only if seed script is cheap.

---

## 3. Voice and copy (UI strings)

Short punchy lines. Hard returns in marketing pages.
Banned in UI and docs you generate: em-dashes, “not just X but Y”, “Here’s the thing”, leverage, unlock, game-changer, soft openers.

Approved copy:
- Empty: “You shipped it. Park it here.”
- Add: “Title. One sentence. Link.”
- Public header: “Tools Maria actually uses.”
- 404 private: “This shelf is closed.”
- CTA: “Put it on the shelf.”
- Open: “Open tool”
- Version note example: “Added tax line”

Do not invent playful empty-state essays.

---

## 4. Stack

Recommended:
- Frontend: React + Vite + Tailwind + shadcn on Cloudflare Pages
- API: Cloudflare Workers (or Pages Functions)
- DB: D1
- Files: R2
- Sessions / rate limits: KV
- Auth: magic link or Google OAuth. Pick one and finish it. Prefer magic link if OAuth setup is slow.
- Email: Resend or Cloudflare Email Routing only if magic link needs it. Otherwise Google OAuth.

Monorepo is fine. Keep it one deployable Pages project if that is faster.

Gotchas:
- Workers have CPU/time limits. Live-check is a scheduled Worker, one HEAD/GET per tool, short timeout, write status to D1.
- Do not scrape HTML for screenshots in v1. User uploads.
- Do not store raw secrets. If a live_url contains `api_key=` or similar, show a warning badge. Do not block save in v1.

---

## 5. D1 schema

Use TEXT ids (ulid or uuid). INTEGER epoch ms for timestamps.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL
);

CREATE TABLE shelves (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  blurb TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  password_hash TEXT,
  custom_domain TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, slug)
);

CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  shelf_id TEXT NOT NULL,
  title TEXT NOT NULL,
  blurb TEXT NOT NULL,
  live_url TEXT NOT NULL,
  screenshot_key TEXT,
  tag TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'live',
  prompt TEXT,
  builder TEXT,
  builder_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  live_url TEXT,
  zip_key TEXT,
  screenshot_key TEXT,
  prompt TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE views (
  tool_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tool_id, day)
);

CREATE INDEX idx_users_handle ON users(handle);
CREATE INDEX idx_shelves_slug ON shelves(slug);
CREATE INDEX idx_tools_shelf ON tools(shelf_id, sort_order);
CREATE INDEX idx_snapshots_tool ON snapshots(tool_id, version);
```

Allowed enums:
- plan: free | pro | agency
- visibility: private | unlisted | public
- tag: invoicing | booking | inventory | internal | other
- status: live | down | draft
- builder: pages | lovable | replit | v0 | bolt | other

KV keys:
- `session:{token}`
- `rate:{ip}`
- `livecheck:{tool_id}` last ping epoch

R2 keys:
- `shots/{user_id}/{tool_id}.webp`
- `shots/{user_id}/{tool_id}/v{n}.webp`
- `zips/{user_id}/{tool_id}/v{n}.zip`

---

## 6. Routes

Public
- GET `/` marketing
- GET `/s/:slug` shelf grid
- GET `/s/:slug/:tool` tool detail
- GET `/og/:slug` OG image (can stub in v1 with static meta)

Auth
- GET `/login`
- POST `/api/auth/magic` or OAuth start
- GET `/api/auth/callback`
- POST `/api/logout`

App (session required)
- GET `/app` owner shelf
- POST `/api/shelves` create default shelf on first login if none
- PATCH `/api/shelves/:id`
- POST `/api/tools`
- PATCH `/api/tools/:id`
- POST `/api/tools/:id/shot` multipart screenshot
- POST `/api/tools/:id/snapshot` create version note + freeze current url/prompt
- POST `/api/tools/:id/make-live` body: `{ version }`
- POST `/api/reorder` body: `{ ids: string[] }`
- POST `/api/tools/:id/ping` owner-triggered live check
- GET `/api/me`

Scheduled
- cron `*/30 * * * *` or daily: ping tools with a live_url, update status.

Rules
- Private shelf + stranger = HTTP 404 and copy “This shelf is closed.”
- Unlisted = no index, reachable by link
- Public = listed on owner page
- Tool visibility cannot be public if parent shelf is private (clamp on write)

---

## 7. Screens to implement (v1)

Reference mockup: `shelf-mockup.html` in this folder.
Visual direction: paper / shop window. Warm off-white `#f4efe6`, ink `#1c1914`, rust `#9b3d1f`, moss `#3d5a3a`. Serif headlines (Fraunces or similar), IBM Plex or equivalent body. Not purple SaaS. Not a feed.

### Login
One card. “Sign in to your shelf.”
One auth method.

### Empty `/app`
Headline: You shipped it. Park it here.
One button: Add a tool
Dashed empty cards.

### Add tool drawer
Fields in this exact order:
1. Title
2. One sentence (blurb)
3. Live URL
4. Screenshot drop zone
5. Tag chips
6. Visibility toggle (private default)
7. Prompt pocket (textarea, optional)
8. Builder chip + builder URL (optional)

Primary: Put it on the shelf
No draft button in v1. Save creates the card.

### Owner shelf `/app`
Handle + plan pill
Add a tool
Draggable or up/down reorder
Card: screenshot, title, one sentence, tag, live/down dot
Hover/menu: Edit, Copy link, Open live

### Public `/s/:slug`
No settings chrome
Title, blurb, grid
Click card → detail

### Tool detail
Large screenshot
Title + sentence
Open tool
Tag, version note, views this week (hide if 0)
Owner-only: prompt pocket, version list, New version, Make this live

### 404
“This shelf is closed.”

Do not build a settings jungle. Shelf title/blurb edit can live in a small dialog on `/app`.

---

## 8. Feature spec (full product intent)

Ship in the order in section 9. This section is the contract for later slices.

### A. Findable
- One default shelf per user in v1
- Filter chips by tag
- Live/down dot
- Pin later (not v1)

### B. Which link is real
- Single live_url on the tool
- snapshots table holds previous live_url + note + optional shot
- “Make v2 live again” writes that snapshot’s live_url onto tools.live_url and bumps display
- Zip snapshot is v1.5

### C. How I built it
- prompt TEXT on tool + copied onto snapshot at freeze time
- builder + builder_url
- “Open in builder” on owner detail only

### D. Share without git
- Visibility triad
- Copy public/unlisted shelf link
- Copy single tool link
- Client shelf = second shelf row with visibility unlisted + optional password_hash (v1.5)

### E. Update without ceremony
- Replace screenshot
- Swap URL (auto-create snapshot of previous if URL changed and user typed a one-line note; if they skip note, use “Updated link”)
- Version notes max 80 chars

### F. Safety
- Warn if URL query looks like a secret
- Private default
- Do not render other users’ private data in any public API

### G. Money (do not implement billing in v1)
- free: 3 tools, public badge “Built on Shelf”
- pro $12: unlimited private tools, hide badge
- agency $29: multiple shelves / client shelves
- Enforcement can be a soft cap with a banner. No Stripe in v1 unless leftover time.

---

## 9. Build order (do this sequence)

### Slice 0 — repo
- Pages + Workers + D1 + R2 + KV wrangler config
- shadcn init
- migrations for schema
- README with `wrangler dev` steps only. Short.

### Slice 1 — auth + empty shelf
- Login works
- First login creates user + default shelf (slug from handle)
- `/app` empty state

### Slice 2 — CRUD cards
- Add drawer
- List cards
- Edit
- Reorder
- Screenshot upload
- Seed Maria’s 4 tools in a `wrangler d1 execute` seed script

### Slice 3 — public pages
- Visibility rules
- `/s/:slug` and detail
- 404 copy
- Copy link

### Slice 4 — memory
- Prompt pocket
- Snapshot on URL change or explicit “Save version”
- Version list + make live
- Builder chip

### Slice 5 — live check
- On-demand ping
- Scheduled ping
- Status dot

### Slice 6 — only if slices 1–5 work
- Client shelf
- Password on unlisted shelf
- Soft plan cap banner
- OG image worker

Stop after slice 5 for the first PR that a human can click.

---

## 10. Validation (you must do this)

### Automated
- Visibility: private shelf is 404 when logged out
- Owner can see private shelf
- Creating a tool without title or live_url fails
- Public JSON/API does not leak prompt or email
- Reorder persists
- Snapshot freezes previous live_url

### Manual click script
1. Sign in as maria
2. Empty state copy is correct
3. Add Flour run log with prompt text
4. Upload a screenshot
5. Public page shows only public cards
6. Change live URL, add note “v2 vendor names”
7. Version list shows v1 and v2
8. Make v1 live again
9. Logged-out user cannot open /app
10. Unknown slug 404s with closed copy

### Product kill test (human, after deploy preview)
Pass:
- Second tool added without coaching
- Someone sends `/s/handle` to another person
- Prompt pocket used on a second session

Fail:
- One vanity card and bounce
- Feature requests are all “can it build the app”

Write a short `VALIDATION.md` after you test, with pass/fail per item. No essays.

---

## 11. Marketing facts (do not code this)

Hook: GitHub for people who will never type git.
Better hook for owners: Park the tool you shipped. Find it Monday.

Do not run ads.
Launch assets: 4 seeded cards + public maria-bakery page screenshot.
Reply energy is for JB, not for the model.

Honest business note:
- Standalone SaaS money is weak
- Wedge value is high next to real owner tools
- Charge later for private + client shelves
- Do not pivot into an app builder

---

## 12. File map (suggested)

```
/README.md                 # run instructions only
/SHELF_HANDOFF.md          # this file
/VALIDATION.md             # you create after tests
/wrangler.toml
/src/pages or src/routes
/src/components/shelf/*
/src/lib/db.ts
/src/lib/auth.ts
/src/lib/r2.ts
/src/workers/livecheck.ts
/migrations/0001_init.sql
/seed/maria.sql
```

Keep components boring:
- ToolCard
- ToolDrawer
- ShelfGrid
- VersionList
- VisibilityToggle
- LiveDot

---

## 13. Definition of done for first handoff back to human

Preview URL on Pages.
Maria seed visible.
Auth works.
Private 404 works.
README says how to run.
VALIDATION.md filled.

If you must cut, cut: drag-reorder, OG images, scheduled cron, builder chips.
Do not cut: visibility rules, screenshot, prompt field, 404 copy.

---

## 14. Questions you may decide without asking

- React + Vite + Pages Functions: yes
- Handle = first 20 chars of email local-part, unique suffix if collision
- Image: accept png/jpg, convert or store as uploaded, max 2MB
- live check: treat HTTP 200-399 as live, everything else down, 5s timeout
- Timezones: store UTC epoch, display local in UI if easy, else UTC date

Ask the human only if auth provider credentials are missing or Wrangler bindings cannot be created.
