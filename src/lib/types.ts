// Mirrors the serialisers in worker/routes/*.ts. If a field is not named
// here, the API does not send it. The owner and public shapes are different
// on purpose: the public one is an allowlist and must never gain prompt,
// builder_url, user_id or shelf_id.

export type Visibility = "private" | "unlisted" | "password" | "public";
export type ToolStatus = "live" | "down" | "draft";
export type Tag = "invoicing" | "booking" | "inventory" | "internal" | "other";
export type Builder = "pages" | "lovable" | "replit" | "v0" | "bolt" | "claude" | "other";

export type Me = { handle: string; name: string; plan: "free" | "studio" };

export type RollUp = {
  state: "empty" | "down" | "stale" | "live";
  label: string | null;
};

export type Shelf = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  client_name: string | null;
  logo_key: string | null;
  accent: string | null;
  visibility: Visibility;
  has_password: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type ShelfListItem = Shelf & {
  tool_count: number;
  last_activity: number;
  status: RollUp;
};

export type Tool = {
  id: string;
  shelf_id: string;
  title: string;
  blurb: string | null;
  live_url: string;
  screenshot_key: string | null;
  section: string | null;
  tag: Tag | null;
  visibility: Visibility;
  sort_order: number;
  version: number;
  status: ToolStatus;
  checked_at: number | null;
  confirmed_at: number | null;
  /** What it runs on. Owner-only, never in the public payload. */
  stack: string | null;
  prompt: string | null;
  builder: Builder | null;
  builder_url: string | null;
  created_at: number;
  updated_at: number;
};

/** What a client sees. Deliberately smaller than Tool. */
export type PublicTool = {
  id: string;
  title: string;
  blurb: string | null;
  section: string | null;
  tag: Tag | null;
  status: ToolStatus;
  screenshot_key: string | null;
  confirmed_at: number | null;
};

export type PublicToolDetail = PublicTool & {
  live_url: string;
  version: number;
  latest_note: string | null;
};

export type PublicShelf = {
  slug: string;
  title: string;
  blurb: string | null;
  client_name: string | null;
  logo_key: string | null;
  accent: string | null;
  badge: boolean;
};

export type Section = { section: string | null; tools: PublicTool[] };

export type Snapshot = {
  id: string;
  version: number;
  live_url: string | null;
  screenshot_key: string | null;
  prompt: string | null;
  note: string | null;
  created_at: number;
};

/** A tool needs confirming when nobody has vouched for it in 90 days. */
export const STALE_MS = 90 * 24 * 60 * 60 * 1000;
export const needsConfirming = (t: { confirmed_at: number | null }) =>
  t.confirmed_at === null || Date.now() - t.confirmed_at > STALE_MS;
