import type { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { needsConfirming } from "@/lib/types";
import type { Tool, PublicTool, Visibility, RollUp } from "@/lib/types";

/* The shared vocabulary. Every screen imports from here rather than
   re-inventing a dot or a rule, so the design cannot drift across files.
   PRD section 10 is the spec. */

/**
 * The shelf edge. Cards sit ON a shelf, and this is the rule they sit on.
 * One per section, so a client with three projects reads as three shelf
 * units on one wall. It is the single device that stops the grid reading as
 * generic cards, so do not soften it into a plain border.
 */
export const ShelfEdge = () => (
  <div aria-hidden className="mt-5">
    <div className="h-0.5 bg-ink" />
    <div className="mt-[3px] h-px bg-line" />
  </div>
);

export const Meta = ({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) => (
  <span
    style={style}
    className={cn("text-xs uppercase tracking-[0.07em] text-muted", className)}
  >
    {children}
  </span>
);

/**
 * 7px dot plus a small-caps word. Never a pill, never an emoji, never three
 * colours at once. Moss live, amber needs confirming, muted down: a dead
 * tool should feel absent rather than alarming.
 *
 * "Needs confirming" outranks "live" because a 200 is not evidence a tool is
 * still in use, and a status with no date beside it is not a fact.
 */
export function LiveDot({
  tool,
  showStale = true,
}: {
  tool: Pick<Tool, "status" | "confirmed_at"> | Pick<PublicTool, "status" | "confirmed_at">;
  showStale?: boolean;
}) {
  const stale = showStale && needsConfirming(tool);
  const [color, label] =
    tool.status === "down"
      ? ["var(--muted)", "Down"]
      : stale
        ? ["var(--amber)", "Needs confirming"]
        : tool.status === "draft"
          ? ["var(--muted)", "Draft"]
          : ["var(--moss)", "Live"];

  return (
    <span className="flex items-center gap-[7px]">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: color }} />
      <Meta style={{ color }}>{label}</Meta>
    </span>
  );
}

export function RollUpDot({ status }: { status: RollUp }) {
  const color =
    status.state === "down"
      ? "var(--muted)"
      : status.state === "stale"
        ? "var(--amber)"
        : status.state === "live"
          ? "var(--moss)"
          : "var(--line)";
  return (
    <span className="flex items-center gap-[7px]">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: color }} />
      {status.label && <Meta style={{ color }}>{status.label}</Meta>}
    </span>
  );
}

const VIS_LABEL: Record<Visibility, string> = {
  private: "Private",
  unlisted: "Unlisted",
  password: "Password",
  public: "Public",
};

export const VisibilityPill = ({ visibility }: { visibility: Visibility }) => (
  <span className="rounded-md border border-line px-2.5 py-1 text-[11px] uppercase tracking-[0.07em] text-muted">
    {VIS_LABEL[visibility]}
  </span>
);

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
}) {
  return (
    <button
      {...props}
      className={cn(
        "h-[42px] rounded-md px-5 text-[15px] font-medium transition-opacity disabled:opacity-40",
        variant === "primary" && "bg-rust text-card hover:opacity-90",
        variant === "outline" && "border border-ink bg-card text-ink hover:bg-paper",
        variant === "ghost" && "text-muted hover:text-ink",
        className
      )}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-[0.07em] text-muted">{label}</div>
      {children}
      {hint && <p className="mt-1.5 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "h-[44px] w-full rounded-md border border-line bg-paper px-3.5 text-[15px] text-ink outline-none placeholder:text-muted/50 focus:border-ink";

/** Paper-toned, never a grey box with an icon. */
export const ShotPlaceholder = ({
  tag,
  className,
}: {
  tag: string | null;
  className?: string;
}) => (
  <div className={cn("flex items-center justify-center bg-paper", className)}>
    {/* Capitalised here so callers can pass the raw enum. Two screens passed
        different casings of the same tag before this lived in one place. */}
    <span className="font-display text-2xl tracking-wide text-line">
      {tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : "Tool"}
    </span>
  </div>
);

export const shotUrl = (key: string | null) =>
  key ? `/api/files/${encodeURI(key)}` : null;

export const SectionHeading = ({ name }: { name: string | null }) =>
  name ? (
    <div className="mb-3.5 font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
      {name}
    </div>
  ) : null;

/* ---------------------------------------------------------------------------
 * Shared helpers.
 *
 * These live here, not in a screen, because seven screens each writing their
 * own is how a design system comes apart. That is not hypothetical: the first
 * pass shipped four different relativeTime functions that disagreed about
 * when a week becomes a month, and two monograms with different fallbacks.
 * If a second file needs one of these, import it. Do not copy it.
 * ------------------------------------------------------------------------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Epoch ms to a plain phrase: "just now", "3 days ago", "last month".
 * A future timestamp is clock skew, not a fact, so it reads as "just now".
 */
export function relativeTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "unknown";

  const diff = Math.max(0, Date.now() - ms);

  if (diff < 45 * 1000) return "just now";
  if (diff < 90 * 1000) return "a minute ago";
  if (diff < HOUR) return `${Math.min(59, Math.round(diff / MINUTE))} minutes ago`;
  if (diff < 90 * MINUTE) return "an hour ago";
  if (diff < DAY) return `${Math.min(23, Math.round(diff / HOUR))} hours ago`;
  if (diff < 36 * HOUR) return "yesterday";

  const days = Math.round(diff / DAY);
  if (days < 7) return `${days} days ago`;
  if (days < 11) return "last week";
  if (days < 45) return `${Math.round(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  if (days < 345) return `${Math.round(days / 30)} months ago`;
  if (days < 400) return "last year";
  // Math.max(2, ...) because days >= 400 rounds to 1 until day 548, and
  // "1 years ago" was rendering for a five-month window.
  return `${Math.max(2, Math.round(days / 365))} years ago`;
}

/** First letter for an avatar tile. One fallback, not two. */
export const monogram = (...candidates: (string | null | undefined)[]): string => {
  for (const c of candidates) {
    const first = Array.from((c ?? "").trim())[0];
    if (first) return first.toUpperCase();
  }
  return "S";
};

/** Outline, not ring. Both existed and they rendered differently. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** Hex guard for a client-supplied accent. Anything else falls back to rust. */
export const safeAccent = (accent: string | null | undefined): string =>
  accent && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(accent) ? accent : "var(--rust)";

/** Only http(s) reaches an href. A stored link is user input. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
