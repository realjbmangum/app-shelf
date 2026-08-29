import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PublicShelf, PublicToolDetail } from "@/lib/types";
import { Button, LiveDot, Meta, ShelfEdge, ShotPlaceholder, shotUrl , relativeTime, focusRing } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * /s/:slug/:toolId. The client's view of one tool. No session, ever.
 *
 * This screen renders PublicToolDetail and nothing else. That payload is an
 * allowlist built in the Worker, and it is smaller than the owner's on
 * purpose: there is no prompt here, no builder, no version list, no sign of
 * another shelf. Do not add a placeholder for the owner blocks and do not
 * leave a gap where they used to sit. The layout is the owner detail with
 * those blocks removed, not the owner detail with holes in it.
 * ------------------------------------------------------------------------- */

/**
 * The client's colour lands here from the database, so it is untrusted text
 * going into a style attribute. Only a plain hex is allowed through, and
 * anything else falls back to rust rather than being written out raw.
 */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const accentValue = (accent: string | null) => {
  const hex = accent?.trim() ?? "";
  return HEX.test(hex) ? hex : "var(--rust)";
};

/** The API validates http(s) on write. This is the second lock on the door. */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);


/**
 * A status with no date beside it is not a fact, so the dot never travels
 * alone when we know when someone last vouched for the tool.
 */
const tagLabel = (tag: string | null) =>
  tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : null;


/** The 12px hairline between meta items, straight from the approved mockup. */
const MetaDivider = () => <span aria-hidden className="h-3 w-px shrink-0 bg-line" />;

type View =
  | { kind: "loading" }
  | { kind: "locked" }
  | { kind: "closed" }
  | { kind: "error" }
  | { kind: "ready"; shelf: PublicShelf; tool: PublicToolDetail };

/**
 * The Worker answers a passphrase shelf with { locked, title } and a 200, on
 * this route as well as the shelf route. api.publicTool is typed for the
 * unlocked answer only, so the locked shape is named here and narrowed on.
 */
type ToolResponse =
  | { shelf: PublicShelf; tool: PublicToolDetail }
  | { locked: true; title: string };

/** Nothing else on the page. No search box, no home link that leaks branding. */
const Closed = () => (
  <main className="flex min-h-screen items-center justify-center px-6">
    <h1 className="font-display text-[27px] font-medium tracking-tight">
      This shelf is closed.
    </h1>
  </main>
);

export default function ClientToolDetail(props: { slug?: string; toolId?: string } = {}) {
  const params = useParams();
  const slug = props.slug ?? params.slug ?? "";
  const toolId = props.toolId ?? params.toolId ?? params.tool ?? "";

  const [view, setView] = useState<View>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [shotBroken, setShotBroken] = useState(false);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!slug || !toolId) {
      setView({ kind: "closed" });
      return;
    }

    let cancelled = false;
    setView({ kind: "loading" });
    setShotBroken(false);

    api
      .publicTool(slug, toolId)
      .then((res: ToolResponse) => {
        if (cancelled) return;
        if ("locked" in res) {
          setView({ kind: "locked" });
          return;
        }
        setView({ kind: "ready", shelf: res.shelf, tool: res.tool });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const closed = err instanceof ApiError && (err.status === 404 || err.code === "closed");
        setView({ kind: closed ? "closed" : "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [slug, toolId, attempt]);

  useEffect(() => {
    if (view.kind === "ready") document.title = view.tool.title;
  }, [view]);

  if (view.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div role="status" aria-live="polite" aria-busy="true">
          <Meta>Loading</Meta>
        </div>
      </main>
    );
  }

  if (view.kind === "closed") return <Closed />;

  // The passphrase gate lives on the shelf screen. Send them there to open it
  // rather than building a second gate that has to be kept in step.
  if (view.kind === "locked")
    return <Navigate to={`/s/${encodeURIComponent(slug)}`} replace />;

  if (view.kind === "error") {
    return (
      <main
        role="status"
        aria-live="polite"
        className="flex min-h-screen flex-col items-center justify-center gap-6 px-6"
      >
        <h1 className="font-display text-[27px] font-medium tracking-tight">
          This did not load.
        </h1>
        <Button variant="outline" onClick={retry} className={cn("h-[44px]", focusRing)}>
          Try again
        </Button>
      </main>
    );
  }

  const { shelf, tool } = view;
  const shot = shotBroken ? null : shotUrl(tool.screenshot_key);
  const tag = tagLabel(tool.tag);
  const confirmed = tool.confirmed_at ? `Confirmed ${relativeTime(tool.confirmed_at)}` : null;
  const openable = isWebUrl(tool.live_url);
  const backLabel = shelf.client_name?.trim() || "All tools";

  return (
    <div
      // The client accent replaces rust on this page and nothing else changes.
      style={{ "--accent": accentValue(shelf.accent) } as CSSProperties}
      className="min-h-screen bg-paper"
    >
      <div className="mx-auto w-full max-w-[1440px] px-6 py-8 lg:px-10 lg:py-10">
        <Link
          to={`/s/${encodeURIComponent(slug)}`}
          className={cn(
            "-ml-1 inline-flex h-11 items-center gap-2 rounded-md px-1 text-sm text-muted transition-colors hover:text-ink",
            focusRing
          )}
        >
          <ArrowLeft size={16} strokeWidth={1.8} aria-hidden />
          {backLabel}
        </Link>

        <div className="mt-4 flex flex-col gap-10 lg:mt-6 lg:flex-row">
          <div className="w-full lg:w-[760px] lg:min-w-0 lg:shrink">
            <div className="overflow-hidden rounded-md border border-line bg-card">
              {shot ? (
                <img
                  src={shot}
                  alt={`Screenshot of ${tool.title}`}
                  onError={() => setShotBroken(true)}
                  className="block aspect-[16/10] w-full object-cover object-top"
                />
              ) : (
                <ShotPlaceholder tag={tag} className="aspect-[16/10] w-full" />
              )}
            </div>
            <ShelfEdge />
          </div>

          <div className="flex min-w-0 flex-1 flex-col lg:max-w-[560px]">
            <h1 className="font-display text-[40px] font-medium leading-[1.15] tracking-[-0.015em]">
              {tool.title}
            </h1>

            {tool.blurb && (
              <p className="mt-3 text-[17px] leading-[1.55] text-muted">{tool.blurb}</p>
            )}

            <div className="mt-[22px] flex flex-wrap items-center gap-x-5 gap-y-3">
              {tag && (
                <>
                  <Meta>{tag}</Meta>
                  <MetaDivider />
                </>
              )}
              <LiveDot tool={tool} />
              {confirmed && (
                <>
                  <MetaDivider />
                  <Meta>{confirmed}</Meta>
                </>
              )}
            </div>

            <div className="mt-7">
              {openable ? (
                <a
                  href={tool.live_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex h-[46px] items-center rounded-md bg-accent px-6 text-base font-medium text-card transition-opacity hover:opacity-90",
                    focusRing
                  )}
                >
                  Open tool
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <p className="text-sm text-muted">This link is not available.</p>
              )}
            </div>

            {tool.latest_note && (
              <p className="mt-8 border-t border-line pt-6 text-sm leading-relaxed text-muted">
                Latest change: <span className="text-ink">{tool.latest_note}</span>
              </p>
            )}
          </div>
        </div>

        {shelf.badge && (
          <footer className="mt-11 flex justify-center">
            <Meta className="tracking-[0.09em]">Built on Shelf</Meta>
          </footer>
        )}
      </div>
    </div>
  );
}
