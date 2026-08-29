import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Me, ShelfListItem } from "@/lib/types";
import { Button, RollUpDot, ShelfEdge, VisibilityPill, inputClass , relativeTime, monogram } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/* The signed-in home. A row per client shelf, because the owner reads this
   list to answer "which client, and is it still true", not to look at
   pictures. Cards are for the client shelf, where the screenshot is the
   goods in the window. See PRD sections 6 and 10. */

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; shelves: ShelfListItem[] };

/* ---------------------------------------------------------------------------
 * Small helpers. Kept local: nothing else needs them yet, and a shared utils
 * file that grows one function per screen is how a codebase gets a junk drawer.
 * ------------------------------------------------------------------------- */


/** Reads like a sentence, not like a timestamp. Never a bare date. */
const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty",
];

/** Spelled out to twenty, then numerals. Print sets small numbers as words. */
const spell = (n: number) => NUMBER_WORDS[n] ?? String(n);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The client's name if the owner set one, otherwise the shelf title. */
const displayName = (s: ShelfListItem) => s.client_name?.trim() || s.title;

/** Array.from, not [0], so an accented or non-latin first letter survives. */

function createMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : "";
  switch (code) {
    case "title_required":
      return "Give the shelf a title.";
    case "title_too_long":
      return "That title is too long.";
    case "client_name_too_long":
      return "That client name is too long.";
    case "blurb_too_long":
      return "That sentence is too long.";
    case "slug_unavailable":
      return "That title is taken. Try another.";
    default:
      return "That did not save. Try again.";
  }
}

/* ---------------------------------------------------------------------------
 * Chrome.
 * ------------------------------------------------------------------------- */

function signOut() {
  api.logout().catch(() => undefined).finally(() => location.assign("/login"));
}

function Header({ me }: { me: Me }) {
  const name = me.name.trim() || me.handle;
  return (
    <header className="flex h-16 items-center justify-between border-b border-line px-10">
      <div className="font-display text-xl font-semibold tracking-[-0.01em]">Shelf</div>
      <div className="flex items-center gap-3.5">
        <span className="text-sm text-muted">{me.handle}</span>
        {/* Plan, not visibility, so this is deliberately not VisibilityPill.
            Studio reads as earned (filled moss), free reads as a hairline. */}
        <span
          className={cn(
            "rounded-md px-2.5 py-1 text-[11px] uppercase tracking-[0.07em]",
            me.plan === "studio"
              ? "bg-moss text-card"
              : "border border-line text-muted"
          )}
        >
          {me.plan === "studio" ? "Studio" : "Free"}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="h-11 px-1 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Sign out
        </button>
        <span
          aria-hidden
          className="flex size-[30px] items-center justify-center rounded-md bg-ink font-display text-sm text-paper"
        >
          {monogram(name)}
        </span>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------------
 * One shelf row.
 * ------------------------------------------------------------------------- */

function ShelfRow({
  shelf,
  copied,
  onCopy,
}: {
  shelf: ShelfListItem;
  copied: "done" | "failed" | null;
  onCopy: (shelf: ShelfListItem) => void;
}) {
  const name = displayName(shelf);
  // A private shelf has no link worth sending, so the action is off rather
  // than handing over a URL that returns "This shelf is closed."
  const noLink = shelf.visibility === "private";
  const tooltip = noLink ? "Private. There is no link to send yet." : undefined;

  return (
    <li className="group relative mb-3 flex items-center gap-5 rounded-md border border-line bg-card px-5 py-[18px] transition-colors hover:border-muted">
      {/* The row is the click target. The link is an overlay rather than a
          wrapper because a button cannot live inside an anchor. */}
      <Link
        to={`/app/${shelf.id}`}
        className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="sr-only">Open {name}</span>
      </Link>

      <span
        aria-hidden
        className="flex size-[46px] shrink-0 items-center justify-center rounded-md border border-line bg-paper font-display text-xl text-ink"
      >
        {monogram(name)}
      </span>

      <div className="min-w-0 grow">
        <div className="truncate font-display text-xl font-medium">{name}</div>
        <div className="mt-[3px] truncate text-[13px] text-muted">
          {plural(shelf.tool_count, "tool")} &middot; updated {relativeTime(shelf.last_activity)}
        </div>
      </div>

      <div className="hidden w-[172px] shrink-0 md:block">
        <RollUpDot status={shelf.status} />
      </div>

      <div className="hidden w-[96px] shrink-0 justify-center sm:flex">
        <VisibilityPill visibility={shelf.visibility} />
      </div>

      <span title={tooltip} className="relative z-10 shrink-0">
        <button
          type="button"
          disabled={noLink}
          title={tooltip}
          onClick={() => onCopy(shelf)}
          className={cn(
            "h-11 w-[104px] text-right text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
            noLink ? "cursor-not-allowed text-muted opacity-60" : "text-rust hover:opacity-80"
          )}
        >
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy link"}
        </button>
      </span>
    </li>
  );
}

/* ---------------------------------------------------------------------------
 * New shelf. A native dialog, so escape, the backdrop and the focus trap are
 * the browser's job rather than three hand-rolled effects.
 * ------------------------------------------------------------------------- */

function NewShelfDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { shelf } = await api.createShelf({
        title: title.trim(),
        client_name: clientName.trim() || undefined,
        blurb: blurb.trim() || undefined,
      });
      navigate(`/app/${shelf.id}`);
    } catch (err) {
      setError(createMessage(err));
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      // A click that lands on the dialog element itself landed on the
      // backdrop. Anything inside the form stops here.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="new-shelf-title"
      className="w-[440px] max-w-[calc(100vw-32px)] rounded-md border border-line bg-card p-8 text-ink backdrop:bg-ink/25"
    >
      <form onSubmit={submit}>
        <h2 id="new-shelf-title" className="font-display text-[27px] font-medium tracking-[-0.015em]">
          New shelf.
        </h2>
        <p className="mt-1.5 text-sm text-muted">One shelf per client.</p>

        <div className="mt-7 flex flex-col gap-5">
          <div>
            <label
              htmlFor="shelf-title"
              className="mb-2 block text-xs uppercase tracking-[0.07em] text-muted"
            >
              Title
            </label>
            <input
              id="shelf-title"
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Maria's Bakery"
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="shelf-client"
              className="mb-2 block text-xs uppercase tracking-[0.07em] text-muted"
            >
              Client name
            </label>
            <input
              id="shelf-client"
              maxLength={120}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Maria"
              className={inputClass}
            />
            <p className="mt-1.5 text-[13px] text-muted">What the client is called on their page.</p>
          </div>

          <div>
            <label
              htmlFor="shelf-blurb"
              className="mb-2 block text-xs uppercase tracking-[0.07em] text-muted"
            >
              One sentence
            </label>
            <textarea
              id="shelf-blurb"
              rows={2}
              maxLength={400}
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              placeholder="What this shelf holds."
              className={cn(inputClass, "h-auto resize-none py-3 leading-relaxed")}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-rust">
            {error}
          </p>
        )}

        <div className="mt-7 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? "Starting..." : "Start the shelf."}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/* ---------------------------------------------------------------------------
 * The screen.
 * ------------------------------------------------------------------------- */

export default function ShelvesList({ me }: { me: Me }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"done" | "failed" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<number | null>(null);

  const fetchShelves = useCallback(() => {
    setLoad({ state: "loading" });
    api
      .listShelves()
      .then(({ shelves }) => setLoad({ state: "ready", shelves }))
      .catch(() => setLoad({ state: "error" }));
  }, []);

  useEffect(fetchShelves, [fetchShelves]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copyLink = useCallback((shelf: ShelfListItem) => {
    const url = `${location.origin}/s/${shelf.slug}`;
    const settle = (result: "done" | "failed") => {
      setCopiedId(shelf.id);
      setCopyState(result);
      setAnnouncement(
        result === "done"
          ? `Client link copied for ${displayName(shelf)}.`
          : "Could not copy the link."
      );
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setCopiedId(null);
        setCopyState(null);
        setAnnouncement("");
      }, 2400);
    };
    // Clipboard access throws outright in an insecure context, so this is a
    // try, not a promise chain with a catch bolted on.
    try {
      const clip = navigator.clipboard as Clipboard | undefined;
      if (!clip) {
        settle("failed");
        return;
      }
      clip.writeText(url).then(
        () => settle("done"),
        () => settle("failed")
      );
    } catch {
      settle("failed");
    }
  }, []);

  const shelves = load.state === "ready" ? load.shelves : [];
  const toolTotal = shelves.reduce((sum, s) => sum + s.tool_count, 0);
  const isEmpty = load.state === "ready" && shelves.length === 0;

  return (
    <div className="flex min-h-screen flex-col">
      <Header me={me} />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {isEmpty ? (
        /* Approved copy, PRD section 10. An empty account is a first
           impression, so it gets the headline and the button, not a
           placeholder sentence. */
        <main className="flex flex-1 flex-col items-center justify-center gap-10 px-10 pb-16">
          <div className="flex flex-col items-center gap-3.5 text-center">
            <h1 className="font-display text-[40px] font-medium leading-[1.1] tracking-[-0.015em]">
              One shelf per client.
            </h1>
            <p className="font-display text-[40px] font-medium leading-[1.1] tracking-[-0.015em] text-muted">
              Start with one.
            </p>
          </div>

          <Button className="h-[46px] px-6 text-base" onClick={() => setDialogOpen(true)}>
            New shelf
          </Button>

          <div aria-hidden className="mt-4 w-full max-w-[900px]">
            <div className="grid grid-cols-3 gap-6">
              <div className="h-[150px] rounded-md border border-dashed border-line" />
              <div className="h-[150px] rounded-md border border-dashed border-line" />
              <div className="h-[150px] rounded-md border border-dashed border-line" />
            </div>
            <ShelfEdge />
          </div>
        </main>
      ) : (
        <main className="px-10 pt-12 pb-16">
          <div className="mb-8 flex items-end justify-between gap-6">
            <div>
              <h1 className="font-display text-[40px] font-medium leading-[1.1] tracking-[-0.015em]">
                Shelves
              </h1>
              <p aria-live="polite" className="mt-1.5 text-sm text-muted">
                {load.state === "loading"
                  ? "Loading your shelves."
                  : load.state === "error"
                    ? "Nothing loaded."
                    : `${spell(shelves.length)} ${shelves.length === 1 ? "client" : "clients"}. ${spell(toolTotal)} ${toolTotal === 1 ? "tool" : "tools"}.`}
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>New shelf</Button>
          </div>

          {load.state === "loading" && (
            /* No shimmer. A quiet hairline row holds the space the shelves
               will take, and says nothing it cannot back up. */
            <ul aria-hidden className="list-none">
              {[0, 1, 2].map((i) => (
                <li key={i} className="mb-3 h-[84px] rounded-md border border-dashed border-line" />
              ))}
            </ul>
          )}

          {load.state === "error" && (
            <div className="rounded-md border border-line bg-card px-6 py-10 text-center">
              <p className="font-display text-xl font-medium">That did not load.</p>
              <p className="mt-1.5 text-sm text-muted">The shelves are still there.</p>
              <Button variant="outline" className="mt-5" onClick={fetchShelves}>
                Try again
              </Button>
            </div>
          )}

          {load.state === "ready" && (
            <ul className="list-none">
              {shelves.map((shelf) => (
                <ShelfRow
                  key={shelf.id}
                  shelf={shelf}
                  copied={copiedId === shelf.id ? copyState : null}
                  onCopy={copyLink}
                />
              ))}
            </ul>
          )}
        </main>
      )}

      <NewShelfDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
