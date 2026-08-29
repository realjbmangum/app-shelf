import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Shelf, Snapshot, Tag, Tool, ToolStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Button,
  LiveDot,
  Meta,
  ShelfEdge,
  ShotPlaceholder,
  inputClass,
  shotUrl,
  relativeTime,
  focusRing,
} from "@/components/ui/primitives";

/* ---------------------------------------------------------------------------
 * Tool detail, owner view. /app/:shelfId/:toolId
 *
 * The left column is the goods in the window. The right column is the record:
 * what it is, whether it is true, and everything the client never sees.
 *
 * The tool prop is the source of truth. Every write reports upward through
 * onChanged so the shelf behind this screen stays in step, and a local copy
 * keeps the screen correct even if the parent chooses not to re-render.
 * ------------------------------------------------------------------------- */

const NOTE_MAX = 80;

const TAG_LABEL: Record<Tag, string> = {
  invoicing: "Invoicing",
  booking: "Booking",
  inventory: "Inventory",
  internal: "Internal",
  other: "Other",
};

const BUILDER_LABEL: Record<string, string> = {
  pages: "Pages",
  lovable: "Lovable",
  replit: "Replit",
  v0: "v0",
  bolt: "Bolt",
  claude: "Claude",
};

const STATUSES: readonly string[] = ["live", "down", "draft"];
const asStatus = (value: string, fallback: ToolStatus): ToolStatus =>
  STATUSES.includes(value) ? (value as ToolStatus) : fallback;

/** A stored link is user input. Only http(s) ever reaches an href. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}


function shortDate(ts: number): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/** Text button. Rust for an action, muted for a passive one. */
const textButtonClass =
  "inline-flex min-h-11 items-center gap-2 rounded-md text-[13px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-card";

/** Keeps a 44px target from stretching a tight row. */
const tightTarget = "-my-3";


type Props = {
  tool: Tool;
  shelf: Shelf;
  onChanged: (t: Tool) => void;
};

type VersionState =
  | { phase: "loading" }
  | { phase: "error" }
  | {
      phase: "ready";
      current_version: number;
      live_version: number | null;
      versions: Snapshot[];
    };

export default function ToolDetail({ tool, shelf, onChanged }: Props) {
  // Seeded from the prop, resynced whenever the parent hands over a new object.
  const [current, setCurrent] = useState<Tool>(tool);
  const [seed, setSeed] = useState<Tool>(tool);
  const latest = useRef<Tool>(tool);
  if (seed !== tool) {
    setSeed(tool);
    setCurrent(tool);
    latest.current = tool;
  }

  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const [versions, setVersions] = useState<VersionState>({ phase: "loading" });
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [makingLive, setMakingLive] = useState<number | null>(null);

  const toolId = current.id;

  /** Patches the tool, reports it upward, and never reads a stale closure. */
  function apply(patch: Partial<Tool>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setCurrent(next);
    onChanged(next);
  }

  const loadVersions = useCallback(async () => {
    setVersions({ phase: "loading" });
    try {
      const res = await api.versions(toolId);
      setVersions({ phase: "ready", ...res });
    } catch {
      setVersions({ phase: "error" });
    }
  }, [toolId]);

  /** Reload after a write. Keeps the list and the tool's number in step. */
  const refresh = useCallback(async () => {
    try {
      const res = await api.versions(toolId);
      setVersions({ phase: "ready", ...res });
      apply({ version: res.current_version });
    } catch {
      setVersions({ phase: "error" });
    }
    // Keyed on the tool only: apply reads a ref, so it needs no dependency.
  }, [toolId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function stillTrue() {
    setConfirming(true);
    setNotice(null);
    try {
      const res = await api.confirm(toolId);
      apply({ confirmed_at: res.confirmed_at });
      setNotice("Confirmed just now.");
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === "rate_limited"
          ? "Too many tries. Wait an hour."
          : "That did not save. Try again."
      );
    } finally {
      setConfirming(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    setNotice(null);
    try {
      const res = await api.ping(toolId);
      const status = asStatus(res.status, current.status);
      apply({ status, checked_at: res.checked_at });
      setNotice(
        status === "live"
          ? "It answers. Checked just now."
          : res.reason
            ? `No answer: ${res.reason}. Checked just now.`
            : "No answer. Checked just now."
      );
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setNotice(
        code === "rate_limited"
          ? "Checked too often. Try again in an hour."
          : code === "no_live_url"
            ? "There is no link to check."
            : code === "check_unavailable"
              ? "The check is off right now. Try again later."
              : "That check did not run. Try again."
      );
    } finally {
      setChecking(false);
    }
  }

  async function copyPrompt() {
    if (!current.prompt) return;
    try {
      await navigator.clipboard.writeText(current.prompt);
      setCopied(true);
      setCopyNote("Prompt copied.");
    } catch {
      setCopied(false);
      setCopyNote("Copy did not work. Select the text instead.");
    }
  }

  // The write and the reload are reported separately on purpose. A failed
  // reload must never be read back to the user as a failed save.
  async function saveVersion() {
    setSaving(true);
    setNotice(null);
    try {
      await api.snapshot(toolId, note.trim() || undefined);
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === "version_exists"
          ? "That version already exists. Try again."
          : "That did not save. Try again."
      );
      setSaving(false);
      return;
    }
    setNote("");
    setNoting(false);
    setNotice("Version saved.");
    setSaving(false);
    await refresh();
  }

  async function makeLive(version: number) {
    setMakingLive(version);
    setNotice(null);
    try {
      const res = await api.makeLive(toolId, version);
      // prompt too: make-live restores the snapshot's prompt server-side, so
      // applying only the url leaves the pocket showing text that is gone.
      apply({ live_url: res.live_url, prompt: res.prompt, confirmed_at: res.confirmed_at });
      setNotice(`v${res.version} is live now.`);
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === "rate_limited"
          ? "Too many tries. Wait an hour."
          : "That did not go live. Try again."
      );
      setMakingLive(null);
      return;
    }
    setMakingLive(null);
    await refresh();
  }

  const shot = shotUrl(current.screenshot_key);
  const openHref = safeHref(current.live_url);
  const builderHref = current.builder_url ? safeHref(current.builder_url) : null;
  const builderName = current.builder ? BUILDER_LABEL[current.builder] : undefined;
  const crumb = shelf.client_name ?? shelf.title;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center gap-3 border-b border-line px-10">
        <a
          href="/app"
          className={cn("font-display text-xl font-semibold text-ink", focusRing)}
        >
          Shelf
        </a>
        <span aria-hidden className="text-line">
          /
        </span>
        <a
          href={`/app/${shelf.id}`}
          className={cn("text-sm text-muted hover:text-ink", focusRing)}
        >
          {crumb}
        </a>
        <span aria-hidden className="text-line">
          /
        </span>
        <span className="truncate text-sm text-ink">{current.title}</span>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-10 py-10 lg:flex-row">
        {/* Left. The goods in the window. */}
        <div className="w-full lg:w-[760px] lg:shrink-0">
          <div className="overflow-hidden rounded-md border border-line bg-card">
            {shot ? (
              <img
                src={shot}
                alt={`Screenshot of ${current.title}`}
                className="block aspect-[16/10] w-full object-cover object-top"
              />
            ) : (
              <ShotPlaceholder
                tag={current.tag ? TAG_LABEL[current.tag] : null}
                className="aspect-[16/10] w-full"
              />
            )}
          </div>
          <ShelfEdge />
        </div>

        {/* Right. The record. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="font-display text-[40px] font-medium leading-[1.15] tracking-[-0.015em]">
            {current.title}
          </h1>
          {current.blurb && (
            <p className="mt-3 text-[17px] leading-[1.55] text-muted">{current.blurb}</p>
          )}

          <div
            aria-live="polite"
            className="mt-[22px] flex flex-wrap items-center gap-x-5 gap-y-2"
          >
            {current.tag && (
              <>
                <Meta>{TAG_LABEL[current.tag]}</Meta>
                <span aria-hidden className="h-3 w-px bg-line" />
              </>
            )}
            <LiveDot tool={current} />
            <span aria-hidden className="h-3 w-px bg-line" />
            <Meta>
              {current.confirmed_at
                ? `Confirmed ${relativeTime(current.confirmed_at)}`
                : "Never confirmed"}
            </Meta>
            <span aria-hidden className="h-3 w-px bg-line" />
            <button
              type="button"
              onClick={checkNow}
              disabled={checking}
              className={cn(textButtonClass, tightTarget, "text-rust focus-visible:ring-offset-paper")}
            >
              {checking ? "Checking..." : "Check now"}
            </button>
          </div>

          <p role="status" className={cn("text-[13px] text-muted", notice && "mt-3")}>
            {notice}
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            {openHref ? (
              // An anchor, because this leaves the product. Styled to match the
              // primary button rather than nesting one inside a link.
              <a
                href={openHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex h-[46px] items-center rounded-md bg-rust px-6 text-base font-medium text-card transition-opacity hover:opacity-90",
                  focusRing
                )}
              >
                Open tool
              </a>
            ) : (
              <p className="text-[13px] text-muted">No link saved yet.</p>
            )}
            <Button
              variant="outline"
              onClick={stillTrue}
              disabled={confirming}
              className={cn("h-[46px]", focusRing)}
            >
              {confirming ? "Saving..." : "Still true"}
            </Button>
          </div>

          <div aria-hidden className="my-8 h-px bg-line" />
          <Meta className="mb-3 block">Only you can see the rest</Meta>

          {/* Prompt pocket. */}
          {current.prompt ? (
            <section className="rounded-md border border-line bg-card px-5 py-[18px]">
              <Meta className="mb-2.5 block">Prompt pocket</Meta>
              <p className="whitespace-pre-wrap text-sm leading-[1.6] text-ink">
                {current.prompt}
              </p>
              <button
                type="button"
                onClick={copyPrompt}
                className={cn(textButtonClass, "-mb-2.5 mt-0.5 text-rust")}
              >
                {copied ? (
                  <Check size={14} strokeWidth={1.8} aria-hidden />
                ) : (
                  <Copy size={14} strokeWidth={1.8} aria-hidden />
                )}
                {copied ? "Copied" : "Copy prompt"}
              </button>
              <span role="status" className="sr-only">
                {copyNote}
              </span>
            </section>
          ) : (
            <section className="rounded-md border border-dashed border-line bg-card px-5 py-[18px]">
              <Meta className="mb-2.5 block">Prompt pocket</Meta>
              <p className="text-sm leading-[1.6] text-muted">
                Nothing in the pocket yet.
                <br />
                Paste the prompt that built this. It is the part that always gets lost.
              </p>
            </section>
          )}

          {/* Versions. */}
          <section className="mt-4 rounded-md border border-line bg-card px-5 py-[18px]">
            <div className="mb-3.5 flex items-center justify-between gap-4">
              <Meta>Versions</Meta>
              {!noting && (
                <button
                  type="button"
                  onClick={() => setNoting(true)}
                  className={cn(textButtonClass, tightTarget, "text-rust")}
                >
                  New version
                </button>
              )}
            </div>

            {noting && (
              <div className="mb-4 border-b border-line pb-4">
                {/* A real label, so the note field is announced with its name. */}
                <label
                  htmlFor="version-note"
                  className="mb-2 block text-xs uppercase tracking-[0.07em] text-muted"
                >
                  Note
                </label>
                <input
                  id="version-note"
                  value={note}
                  autoFocus
                  maxLength={NOTE_MAX}
                  aria-describedby="version-note-count"
                  onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                  placeholder="Added tax line"
                  className={cn(inputClass, focusRing)}
                />
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span id="version-note-count" className="text-xs text-muted">
                    {note.length}/{NOTE_MAX}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setNoting(false);
                        setNote("");
                      }}
                      className={cn(textButtonClass, tightTarget, "text-muted")}
                    >
                      Cancel
                    </button>
                    <Button
                      variant="outline"
                      onClick={saveVersion}
                      disabled={saving}
                      className={cn("h-[38px] px-4 text-sm", focusRing)}
                    >
                      {saving ? "Saving..." : "Save version"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div aria-live="polite">
              {versions.phase === "loading" && (
                <p className="py-2 text-sm text-muted">Loading versions.</p>
              )}

              {versions.phase === "error" && (
                <div className="flex flex-wrap items-center justify-between gap-3 py-1">
                  <p className="text-sm text-muted">Versions did not load.</p>
                  <button
                    type="button"
                    onClick={() => void loadVersions()}
                    className={cn(textButtonClass, tightTarget, "text-rust")}
                  >
                    Try again
                  </button>
                </div>
              )}

              {versions.phase === "ready" && versions.versions.length === 0 && (
                <p className="py-1 text-sm leading-[1.6] text-muted">
                  Nothing saved yet.
                  <br />
                  Save a version before you change the link. It is how you get back.
                </p>
              )}
            </div>

            {versions.phase === "ready" &&
              versions.versions.map((v, i) => {
                const isLive = v.version === versions.live_version;
                const last = i === versions.versions.length - 1;
                return (
                  <div key={v.id}>
                    {i > 0 && <div aria-hidden className="h-px bg-line" />}
                    <div
                      className={cn(
                        "flex items-center gap-3.5 py-[13px]",
                        i === 0 && "pt-0",
                        last && "pb-0"
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-[7px] shrink-0 rounded-full"
                        style={{ background: isLive ? "var(--moss)" : "var(--line)" }}
                      />
                      <span
                        className={cn(
                          "w-7 shrink-0 font-display text-[17px]",
                          isLive ? "text-ink" : "text-muted"
                        )}
                      >
                        v{v.version}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          isLive ? "text-ink" : "text-muted"
                        )}
                        title={v.note ?? undefined}
                      >
                        {v.note ?? "Updated link"}
                      </span>
                      <span className="shrink-0 text-[13px] text-muted">
                        {shortDate(v.created_at)}
                      </span>
                      <span className="w-24 shrink-0 text-right">
                        {isLive ? (
                          <span className="text-[13px] text-muted">Live now</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => makeLive(v.version)}
                            disabled={makingLive !== null}
                            className={cn(textButtonClass, tightTarget, "text-rust")}
                          >
                            {makingLive === v.version ? "Working..." : "Make this live"}
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
          </section>

          {/* Builder. */}
          {builderHref && (
            <a
              href={builderHref}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "mt-2 inline-flex min-h-11 items-center gap-2 self-start text-[13px] text-muted hover:text-ink",
                focusRing
              )}
            >
              <ExternalLink size={14} strokeWidth={1.8} aria-hidden />
              {builderName ? `Built with ${builderName}, open in builder` : "Open in builder"}
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
