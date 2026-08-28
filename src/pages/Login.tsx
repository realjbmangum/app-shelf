import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.sendMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(
        (err as Error).message === "rate_limited"
          ? "Too many tries. Wait an hour."
          : "That did not send. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-14 px-7">
      <div className="flex flex-col items-center gap-2">
        <div className="font-display text-3xl font-semibold tracking-tight">Shelf</div>
        <div className="w-36 shelf-edge" />
      </div>

      <div className="w-full max-w-[420px] rounded-md border border-line bg-card p-10">
        {sent ? (
          <>
            <h1 className="font-display text-2xl font-medium tracking-tight">
              Check your email.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              We sent a link to {email}. It works once and expires in fifteen
              minutes.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-7 text-sm font-medium text-rust hover:underline"
            >
              Use a different address
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1 className="font-display text-2xl font-medium tracking-tight">
              Sign in to your shelf.
            </h1>
            <p className="mb-8 mt-2 text-sm leading-relaxed text-muted">
              We send a link. No password to forget.
            </p>

            <label
              htmlFor="email"
              className="mb-2 block text-xs uppercase tracking-[0.07em] text-muted"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.co"
              className="h-[46px] w-full rounded-md border border-line bg-paper px-3.5 text-base text-ink outline-none placeholder:text-muted/60 focus:border-ink"
            />

            {error && <p className="mt-3 text-sm text-rust">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 h-[46px] w-full rounded-md bg-rust text-base font-medium text-card transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Sending..." : "Send the link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
