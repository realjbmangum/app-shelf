import { api, type Me } from "@/lib/api";

/**
 * Slice 1 stop. The real shelves list arrives in slice 2; this proves the
 * session round-trips and renders the approved empty-state copy.
 */
export default function AppHome({ me }: { me: Me }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-line px-10">
        <div className="font-display text-xl font-semibold">Shelf</div>
        <div className="flex items-center gap-3.5">
          <span className="text-sm text-muted">{me.handle}</span>
          <span
            className={
              me.plan === "studio"
                ? "rounded-md bg-moss px-2.5 py-1 text-[11px] uppercase tracking-[0.07em] text-card"
                : "rounded-md border border-line px-2.5 py-1 text-[11px] uppercase tracking-[0.07em] text-muted"
            }
          >
            {me.plan}
          </span>
          <button
            onClick={() => api.logout().then(() => location.assign("/login"))}
            className="text-sm text-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 pb-16">
        <div className="flex flex-col items-center gap-3">
          <h1 className="font-display text-4xl font-medium tracking-tight">
            One shelf per client.
          </h1>
          <p className="font-display text-4xl font-medium tracking-tight text-muted">
            Start with one.
          </p>
        </div>

        <button
          disabled
          title="Slice 2"
          className="h-[46px] rounded-md bg-rust px-6 text-base font-medium text-card opacity-40"
        >
          New shelf
        </button>

        <div className="w-full max-w-[900px] px-10">
          <div className="grid grid-cols-3 gap-6">
            <div className="h-[150px] rounded-md border border-dashed border-line" />
            <div className="h-[150px] rounded-md border border-dashed border-line" />
            <div className="h-[150px] rounded-md border border-dashed border-line" />
          </div>
          <div className="mt-0 h-0.5 bg-line" />
          <div className="mt-[3px] h-px bg-line/50" />
        </div>
      </main>
    </div>
  );
}
