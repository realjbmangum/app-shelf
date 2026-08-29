import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Button, ShelfEdge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { monogram, focusRing } from "@/components/ui/primitives";
export { relativeTime } from "@/components/ui/primitives";

/*
 * The signed-in chrome. Every /app screen wears this header, so it is the one
 * place the wordmark, the breadcrumbs and sign out are defined. PRD section 10
 * is the spec, design/Main.dc.html and design/EmptyAccount.dc.html are the
 * approved layouts.
 */

export type Crumb = { label: string; to?: string };

/* -------------------------------------------------------------------------
 * relativeTime
 * ---------------------------------------------------------------------- */


/* -------------------------------------------------------------------------
 * Header
 * ---------------------------------------------------------------------- */


function PlanPill({ plan }: { plan: Me["plan"] }) {
  return (
    <span
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] uppercase tracking-[0.07em]",
        plan === "studio"
          ? "bg-moss text-card"
          : "border border-line text-muted"
      )}
    >
      {plan === "studio" ? "Studio" : "Free"}
    </span>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const last = crumbs.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-3">
        {crumbs.map((crumb, i) => (
          <li key={`${crumb.to ?? crumb.label}-${i}`} className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="text-line">
              /
            </span>
            {crumb.to && i !== last ? (
              <Link
                to={crumb.to}
                className={cn(
                  "max-w-[180px] truncate rounded-md text-sm text-muted hover:text-ink sm:max-w-[260px]",
                  focusRing
                )}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                aria-current={i === last ? "page" : undefined}
                className="max-w-[180px] truncate text-sm text-ink sm:max-w-[260px]"
              >
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * 64px, one hairline underneath, nothing else. Wordmark left, then the trail.
 * Handle, plan and sign out right.
 */
export function AppHeader({ me, crumbs }: { me: Me; crumbs?: Crumb[] }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api.logout();
    } catch {
      // The session may already be gone. Leave anyway: a failed logout must
      // never strand someone on a screen they can no longer load.
    }
    window.location.assign("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-paper px-6 sm:px-10">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/app"
          className={cn(
            "rounded-md font-display text-xl font-semibold tracking-[-0.01em] text-ink",
            focusRing
          )}
        >
          Shelf
        </Link>
        {crumbs && crumbs.length > 0 && <Breadcrumbs crumbs={crumbs} />}
      </div>

      <div className="flex shrink-0 items-center gap-3.5">
        <span className="text-sm text-muted">{me.handle}</span>
        <PlanPill plan={me.plan} />
        <span
          aria-hidden
          className="hidden size-[30px] items-center justify-center rounded-md bg-ink font-display text-sm text-paper sm:flex"
        >
          {monogram(me.name, me.handle)}
        </span>
        <Button
          variant="ghost"
          type="button"
          onClick={signOut}
          disabled={busy}
          className={cn("px-3 text-sm", focusRing)}
        >
          {busy ? "Signing out..." : "Sign out"}
        </Button>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------
 * Empty account
 * ---------------------------------------------------------------------- */

/**
 * No shelves yet. The three dashed cards on a shelf edge say what this screen
 * is for without a diagram or a tour, and they are the only thing here besides
 * the two lines and the one button.
 */
export function EmptyAccount({ me, onNew }: { me: Me; onNew: () => void }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AppHeader me={me} />

      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 pb-16 pt-16 sm:px-10">
        <h1 className="text-center font-display text-[40px] font-medium leading-[1.1] tracking-[-0.015em]">
          <span className="block">One shelf per client.</span>
          <span className="mt-3.5 block text-muted">Start with one.</span>
        </h1>

        <Button
          type="button"
          onClick={onNew}
          className="h-[46px] px-[26px] text-base"
        >
          New shelf
        </Button>

        <div aria-hidden className="w-full max-w-[900px]">
          <div className="grid grid-cols-3 gap-4 sm:gap-6">
            <div className="h-[110px] rounded-md border border-dashed border-line sm:h-[150px]" />
            <div className="h-[110px] rounded-md border border-dashed border-line sm:h-[150px]" />
            <div className="h-[110px] rounded-md border border-dashed border-line sm:h-[150px]" />
          </div>
          <ShelfEdge />
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Shell
 * ---------------------------------------------------------------------- */

/**
 * The wrapper every /app screen sits in. It owns the page gutter and the top
 * padding, so a screen inside it starts writing at its own first heading and
 * does not add its own outer padding.
 */
export default function AppShell({
  me,
  crumbs,
  children,
}: {
  me: Me;
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-4 py-2 text-sm text-paper focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-40"
      >
        Skip to content
      </a>

      <AppHeader me={me} crumbs={crumbs} />

      <main
        id="main"
        className="mx-auto w-full max-w-[1440px] flex-1 px-6 pb-20 pt-10 sm:px-10 sm:pt-12"
      >
        {children}
      </main>
    </div>
  );
}
