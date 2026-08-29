# Shelf

Where an agency parks every tool it built for a client, on one link the
client can use. Repo: `realjbmangum/app-shelf`.

**Read `SHELF-PRD.html` before writing code.** It is the spec. This file
carries only the decisions a session would otherwise re-derive or get
wrong, plus the ones that are expensive to reverse.

## Status (28 Aug 2026)

Spec and design done, no application code. Next work is slice 0.

## Stack, locked

| Layer | Decision |
|---|---|
| Runtime | **Cloudflare Workers with static assets. NOT Pages.** |
| Frontend | React + Vite + Tailwind + shadcn, served as static assets from the Worker |
| API | Hono, same Worker |
| Data | D1. Files: R2. Sessions and rate limits: KV. |
| Auth | Magic link, built in-app, email via SendGrid |

### Why Workers and not Pages

Pages does not support Cron Triggers, Email Workers, Queue Consumers, or
the Rate Limiting binding. Slice 5 is a scheduled live check, so Pages
cannot ship this product.

Workers-with-assets also keeps the frontend and the API in one
deployable. **Do not later split the API into its own Worker.** The
moment they deploy separately, one of them ships from a branch and the
other from a working tree, and production breaks in a way that takes a
session to find.

### Why not Cloudflare Access / Zero Trust

Access is right for an internal admin route and wrong for customer auth:

- **$7 per user per month past 50 free seats, charged on signups, not on
  customers.** A free-tier signup costs $7/mo to exist, and the free
  ceiling is hit at 50 signups, so it breaks exactly when the product
  starts working.
- Access authorises a list an admin configures. Self-serve signup would
  mean calling the Cloudflare API to mutate an Access group per
  registration, putting the user directory in Cloudflare's policy engine
  instead of D1.
- It gates at the perimeter before your code runs. Shelf serves public
  `/s/:slug` and private `/app` from one origin.
- The client never signs in at all. "Unlisted link plus a passphrase" is
  not expressible in Access.

Access **does** belong in front of Shelf's own operator route.

### Email gotcha

Cloudflare Email Routing on its own can only send to **verified
destination addresses on your own account**, so it cannot deliver a magic
link to a stranger. Outbound to arbitrary recipients needs a sending
domain onboarded through Cloudflare Email Service, or an ESP. SendGrid is
the choice, with **its own API key and its own sending subdomain**, so a
deliverability problem here cannot spread anywhere else.

## Non-negotiables

Cut anything else first. These are in the PRD with tests attached.

1. **`shelves.slug` is globally unique.** The original brief had
   `UNIQUE(user_id, slug)` under a `/s/:slug` route that cannot resolve
   two identical slugs.
2. **Ownership checks on every `:id` route**, returning **404 not 403**.
   Session-required is not the check. This is a plain IDOR otherwise.
3. **SSRF guard on the live check.** It is an outbound fetch proxy over
   user-supplied URLs: http(s) only, block localhost, private ranges and
   cloud metadata endpoints by resolved host, cap redirects at 3, 5s
   timeout, rate limit the owner-triggered ping.
4. **Public payloads through an explicit allowlist**, never by deleting
   keys off the internal object. Never leak `prompt`, `builder_url`,
   `email`, or the existence of another shelf.
5. **A tool cannot be more visible than its shelf.** Clamp on write.
6. **`confirmed_at` on every tool**, 90-day stale flag, "Still true"
   action. A 200 response is not evidence a tool is still in use, and a
   status with no date beside it is not a fact. The failure this prevents
   is a card reading LIVE for months after the thing behind it died.

## Model

`account > shelf (one per client) > section (optional free text) > tool > version`

No `clients` table, no `sections` table, no teams or seats in v1. A client
with several projects gets sections inside one shelf, never several
shelves: several shelves means several links, which is the scattering
problem the product exists to end.

## Voice

Short lines. Hard returns. **No em dashes.** Banned: "not just X but Y",
leverage, unlock, game-changer, seamless, effortless, soft openers. The UI
never says branch, commit, repo, pull, merge, diff, or README. Approved
strings are in PRD section 10.

Do not use "GitHub for people who will never type git" anywhere public. It
sells to developers, who will not pay for this.

## Do not

- Pivot into an app builder. Half the AI app builders launched in 2025
  were dead by April 2026. Shelf survives by outliving them, which it only
  does if it never competes with them.
- Build Stripe before the kill test passes (PRD section 12).
- Rebuild the `views` table. It was cut on purpose: a D1 write per public
  page view on the one unbounded-traffic table.

## Do, eventually

**Frozen build copies (PRD 7.6).** A version stores a link, a prompt and a
picture. It does not store the tool. If the host a tool sits on folds, Shelf
holds a dead link and a photograph, which is the opposite of the durability
it sells. The fix is one nullable `zip_key` on `snapshots` plus
`zips/{user_id}/{tool_id}/v{n}.zip`, and the UI says "Keep a copy" and
"Download this version" and never says branch, diff or merge. It is v1.5
because the storage grows without bound and a copy nobody uploads proves
nothing, not because it is optional.

This is the riskiest cut in the spec. It was dropped once already without
being flagged. Do not drop it again silently.
