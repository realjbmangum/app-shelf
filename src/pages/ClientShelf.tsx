import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { PublicShelf, PublicTool, Section } from "@/lib/types";
import {
  LiveDot,
  Meta,
  SectionHeading,
  ShelfEdge,
  ShotPlaceholder,
  Button,
  inputClass,
  shotUrl,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * THE CLIENT SHELF. /s/:slug
 *
 * The only screen a client ever sees. There is no session, no nav, no login
 * prompt, no settings, and no route out of here except to a tool on this same
 * shelf. Nothing on this page may reveal that another shelf exists.
 *
 * Every field rendered here comes off the public allowlist in
 * worker/routes/publicShelf.ts. If a field is not on PublicShelf or
 * PublicTool, the API did not send it and this screen must not ask for it.
 *
 * A 404 is the same answer for "no such shelf" and "private shelf", so the
 * closed copy is the only thing that renders for either.
 * ------------------------------------------------------------------------- */

/** The client's colour, and it can be any hex they gave the agency. */
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Returns a six-digit hex, or null if the stored value is not a colour. */
function normalizeAccent(raw: string | null): string | null {
  const value = raw?.trim();
  if (!value || !HEX.test(value)) return null;
  const digits = value.toLowerCase().slice(1);
  return digits.length === 3
    ? `#${[...digits].map((d) => d + d).join("")}`
    : `#${digits}`;
}

/**
 * Ink or card for the monogram letter, by the luminance of the client's own
 * colour. A pale brand colour with a paper-white letter on it is unreadable,
 * and we do not get to pick the hex.
 */
function inkOn(hex: string | null): string {
  if (!hex) return "var(--card)";
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return luminance > 0.4 ? "var(--ink)" : "var(--card)";
}

function monogram(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "";
}

type State =
  | { k: "loading" }
  | { k: "locked"; title: string }
  | { k: "ready"; shelf: PublicShelf; sections: Section[] }
  | { k: "closed" }
  | { k: "error" };

export default function ClientShelf({ slug: slugProp }: { slug?: string } = {}) {
  const params = useParams<{ slug: string }>();
  const slug = slugProp ?? params.slug ?? "";

  const [state, setState] = useState<State>({ k: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ k: "loading" });

    api
      .publicShelf(slug)
      .then((res) => {
        if (!live) return;
        if (res.locked) setState({ k: "locked", title: res.title ?? "" });
        else if (!res.shelf) setState({ k: "error" });
        else setState({ k: "ready", shelf: res.shelf, sections: res.sections ?? [] });
      })
      .catch((err: unknown) => {
        if (!live) return;
        const closed = err instanceof ApiError && err.status === 404;
        setState(closed ? { k: "closed" } : { k: "error" });
      });

    return () => {
      live = false;
    };
  }, [slug, attempt]);

  useEffect(() => {
    if (state.k === "ready") document.title = state.shelf.title;
    if (state.k === "locked" && state.title) document.title = state.title;
  }, [state]);

  if (state.k === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div role="status" aria-live="polite">
          <Meta>Loading</Meta>
        </div>
      </main>
    );
  }

  // Same page for a slug that never existed and a shelf we will not confirm.
  if (state.k === "closed") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <h1 className="font-display text-[27px] font-medium tracking-tight">
          This shelf is closed.
        </h1>
      </main>
    );
  }

  if (state.k === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
        <h1 className="font-display text-[27px] font-medium tracking-tight">
          This did not load.
        </h1>
        <Button
          variant="outline"
          className="h-[44px]"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Try again
        </Button>
      </main>
    );
  }

  if (state.k === "locked") return <Gate slug={slug} title={state.title} />;

  return <Shelf slug={slug} shelf={state.shelf} sections={state.sections} />;
}

/* ---------------------------------------------------------------------------
 * The gate. All it knows is the title, because that is all the API sent.
 * ------------------------------------------------------------------------- */

function Gate({ slug, title }: { slug: string; title: string }) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.unlock(slug, passphrase);
      // The cookie is set. Reload so the shelf loads as a normal visit.
      window.location.reload();
    } catch (err: unknown) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        code === "wrong"
          ? "That is not it."
          : code === "rate_limited"
            ? "Too many tries. Wait a while."
            : "That did not work. Try again."
      );
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px] rounded-md border border-line bg-card p-10">
        <h1 className="font-display text-[27px] font-medium leading-tight tracking-tight">
          {title || "This shelf has a passphrase."}
        </h1>
        {title && (
          <p className="mt-2 text-base leading-relaxed text-muted">
            This shelf has a passphrase.
          </p>
        )}

        <form onSubmit={submit} className="mt-8">
          <label
            htmlFor="passphrase"
            className="mb-2 block text-xs uppercase tracking-[0.07em] text-muted"
          >
            Passphrase
          </label>
          <input
            id="passphrase"
            name="passphrase"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className={inputClass}
          />

          <div role="status" aria-live="polite">
            {error && <p className="mt-3 text-sm text-rust">{error}</p>}
          </div>

          <Button
            type="submit"
            disabled={busy || passphrase.length === 0}
            className="mt-5 h-[46px] w-full"
          >
            {busy ? "Opening..." : "Open the shelf"}
          </Button>
        </form>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * The shelf itself.
 *
 * --accent is set once, here, on the wrapper. It is the client's colour and
 * it gets exactly one moment on the page: the monogram tile. Everything else
 * stays on the neutral palette, because rust belongs to Shelf and putting a
 * stranger's colour beside it makes one of them look like a mistake.
 * ------------------------------------------------------------------------- */

function Shelf({
  slug,
  shelf,
  sections,
}: {
  slug: string;
  shelf: PublicShelf;
  sections: Section[];
}) {
  const accent = normalizeAccent(shelf.accent);
  const style = { "--accent": accent ?? "var(--rust)" } as CSSProperties;

  const logo = shotUrl(shelf.logo_key);
  const name = shelf.client_name?.trim() || shelf.title;
  const letter = monogram(name);

  const runs = sections.filter((s) => s.tools.length > 0);

  return (
    <div style={style} className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-[1360px] px-6 pb-20 pt-16 lg:px-10">
        <header className="mb-11">
          <div className="mb-[26px] flex items-center gap-[18px]">
            {logo ? (
              <img
                src={logo}
                alt={name}
                className="size-14 shrink-0 rounded-md border border-line bg-card object-contain"
              />
            ) : (
              <div
                aria-hidden
                className="flex size-14 shrink-0 items-center justify-center rounded-md font-display text-[27px]"
                style={{ background: "var(--accent)", color: inkOn(accent) }}
              >
                {letter}
              </div>
            )}
            <h1 className="font-display text-[40px] font-medium leading-[1.1] tracking-[-0.015em]">
              {shelf.title}
            </h1>
          </div>

          {shelf.blurb && (
            <p className="max-w-[640px] text-[17px] leading-[1.55] text-muted">
              {shelf.blurb}
            </p>
          )}
        </header>

        {runs.length === 0 ? (
          <section className="py-16 text-center">
            <p className="font-display text-[27px] font-medium tracking-tight">
              Nothing on this shelf yet.
            </p>
            <div className="mx-auto w-40">
              <ShelfEdge />
            </div>
          </section>
        ) : (
          runs.map((run, i) => (
            <section key={run.section ?? "__unsectioned"} className={cn(i > 0 && "mt-9")}>
              <SectionHeading name={run.section} />
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {run.tools.map((tool) => (
                  <ToolCard key={tool.id} slug={slug} tool={tool} />
                ))}
              </div>
              <ShelfEdge />
            </section>
          ))
        )}

        {shelf.badge && (
          <footer className="mt-11 flex justify-center">
            <Meta className="tracking-[0.09em]">Built on Shelf</Meta>
          </footer>
        )}
      </div>
    </div>
  );
}

/* One card, one tool. The whole card is the link, so the hit target is the
   card and not a word inside it. */
function ToolCard({ slug, tool }: { slug: string; tool: PublicTool }) {
  const shot = shotUrl(tool.screenshot_key);

  return (
    <Link
      to={`/s/${encodeURIComponent(slug)}/${encodeURIComponent(tool.id)}`}
      className="flex flex-col overflow-hidden rounded-md border border-line bg-card transition-colors hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      {shot ? (
        <img
          src={shot}
          alt={`Screenshot of ${tool.title}`}
          loading="lazy"
          decoding="async"
          className="aspect-[16/9] w-full border-b border-line bg-paper object-cover object-top"
        />
      ) : (
        <ShotPlaceholder tag={tool.tag} className="aspect-[16/9] w-full border-b border-line" />
      )}

      <div className="flex flex-1 flex-col p-4">
        <h2 className="font-display text-[20px] font-medium leading-snug">{tool.title}</h2>
        {tool.blurb && (
          <p className="mt-1.5 text-sm leading-[1.5] text-muted">{tool.blurb}</p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          {tool.tag ? <Meta>{tool.tag}</Meta> : <span />}
          <LiveDot tool={tool} />
        </div>
      </div>
    </Link>
  );
}
