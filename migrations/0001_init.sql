-- Shelf, initial schema.
--
-- Model: account > shelf (one per client) > section (a string on the tool)
--        > tool > version.
--
-- Ids are ULIDs (TEXT, lexicographically sortable by creation time).
-- Timestamps are INTEGER epoch milliseconds, UTC.

-- ---------------------------------------------------------------------------
-- users. One account is one login in v1. No teams, no seats.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  handle     TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  plan       TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'studio')),
  created_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- shelves. One per client.
--
-- slug is GLOBALLY unique, not unique-per-user. The public route is
-- /s/:slug with no user in the path, so a per-user constraint would let two
-- accounts claim the same URL and the route could not resolve it. Global
-- uniqueness also keeps the client link short, which matters because the
-- client pastes it into email.
-- ---------------------------------------------------------------------------
CREATE TABLE shelves (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  blurb         TEXT,
  client_name   TEXT,
  logo_key      TEXT,
  accent        TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private', 'unlisted', 'password', 'public')),
  password_hash TEXT,
  custom_domain TEXT,               -- reserved, unused in v1
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- tools.
--
-- section is free text, deliberately not a table: a client with several
-- projects types "Back office" into the drawer and the section exists. It
-- orders by the lowest sort_order among its tools, so reordering cards
-- reorders sections for free. NULL section means the unnamed first group.
--
-- tag stays a closed list. It answers "what kind of tool is this" so the
-- filter chips remain a fixed, predictable set. Different axis from section,
-- neither replaces the other.
--
-- checked_at is when a machine last got a response.
-- confirmed_at is when a HUMAN last said the thing is still true. A 200 is
-- not evidence a tool is still in use, and a status with no date beside it
-- is not a fact. Past 90 days the card reads "Needs confirming".
-- ---------------------------------------------------------------------------
CREATE TABLE tools (
  id             TEXT PRIMARY KEY,
  shelf_id       TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  blurb          TEXT,
  live_url       TEXT NOT NULL,
  screenshot_key TEXT,
  section        TEXT,
  tag            TEXT CHECK (tag IS NULL OR tag IN
                   ('invoicing', 'booking', 'inventory', 'internal', 'other')),
  visibility     TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'unlisted', 'password', 'public')),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  version        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'live'
                 CHECK (status IN ('live', 'down', 'draft')),
  checked_at     INTEGER,
  confirmed_at   INTEGER,
  prompt         TEXT,
  builder        TEXT CHECK (builder IS NULL OR builder IN
                   ('pages', 'lovable', 'replit', 'v0', 'bolt', 'claude', 'other')),
  builder_url    TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- snapshots. A frozen previous live_url + prompt + note.
-- note is capped at 80 chars by the API, not here.
-- ---------------------------------------------------------------------------
CREATE TABLE snapshots (
  id             TEXT PRIMARY KEY,
  tool_id        TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  live_url       TEXT,
  screenshot_key TEXT,
  prompt         TEXT,
  note           TEXT,
  created_at     INTEGER NOT NULL
);

-- No `views` table on purpose. It was a D1 write per public page view, on the
-- one table with unbounded traffic, to produce the least valuable number in
-- the product. If it comes back it is a KV counter flushed on a schedule.

CREATE INDEX idx_shelves_user       ON shelves(user_id, sort_order);
CREATE INDEX idx_tools_shelf        ON tools(shelf_id, sort_order);
CREATE INDEX idx_tools_live_check   ON tools(checked_at);
CREATE UNIQUE INDEX idx_snapshots_tool_version ON snapshots(tool_id, version);
