import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ChevronDown, Image as ImageIcon, TriangleAlert, X } from "lucide-react";
import { api, ApiError, type ToolInput } from "@/lib/api";
import type { Builder, Tag, Tool, Visibility } from "@/lib/types";
import {
  Button,
  Field,
  Meta,
  inputClass,
  shotUrl,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * The add / edit sheet. 480px on the right, over a dimmed backdrop, and the
 * one element in the product carrying a shadow.
 *
 * Field order is the spec (PRD section 6). Do not rearrange it: the drawer
 * reads top to bottom as "title, one sentence, link", which is the whole
 * promise of the product, and everything below that is optional.
 * ------------------------------------------------------------------------- */

export type ToolDrawerProps = {
  shelfId: string;
  shelfVisibility: Visibility;
  tool?: Tool;
  open: boolean;
  onClose: () => void;
  onSaved: (tool: Tool) => void;
  existingSections: string[];
};

const TAGS: { value: Tag; label: string }[] = [
  { value: "invoicing", label: "Invoicing" },
  { value: "booking", label: "Booking" },
  { value: "inventory", label: "Inventory" },
  { value: "internal", label: "Internal" },
  { value: "other", label: "Other" },
];

const BUILDERS: { value: Builder; label: string }[] = [
  { value: "pages", label: "Pages" },
  { value: "claude", label: "Claude" },
  { value: "lovable", label: "Lovable" },
  { value: "replit", label: "Replit" },
  { value: "v0", label: "v0" },
  { value: "bolt", label: "Bolt" },
  { value: "other", label: "Other" },
];

const VISIBILITIES: { value: Visibility; label: string; line: string }[] = [
  {
    value: "private",
    label: "Private",
    line: "Only you. The client shelf will not show it.",
  },
  {
    value: "unlisted",
    label: "Unlisted",
    line: "Anyone with the link. Listed nowhere else.",
  },
  {
    value: "password",
    label: "Password",
    line: "The link plus the passphrase on the shelf.",
  },
  {
    value: "public",
    label: "Public",
    line: "Listed and indexed. For portfolio use.",
  },
];

/**
 * Mirrors RANK in worker/middleware.ts, where password and unlisted sit level
 * with each other. The server clamps on every write regardless. This copy
 * exists so the user is never surprised by a value that quietly changed, and
 * it is not the enforcement.
 */
const RANK: Record<Visibility, number> = {
  private: 0,
  unlisted: 1,
  password: 1,
  public: 2,
};

const MAX_SHOT_BYTES = 2 * 1024 * 1024;

type FieldKey =
  | "title"
  | "blurb"
  | "live_url"
  | "shot"
  | "section"
  | "prompt"
  | "builder_url";

type Errors = Partial<Record<FieldKey, string>>;

const MESSAGES: Record<string, string> = {
  title_required: "Give it a title.",
  title_too_long: "That title is too long.",
  live_url_required: "A link, so the client can open it.",
  live_url_invalid: "That is not a web link.",
  live_url_scheme: "A link starts with http or https.",
  live_url_too_long: "That link is too long.",
  blurb_too_long: "Keep it to one sentence.",
  section_too_long: "That section name is too long.",
  prompt_too_long: "That prompt is too long to store.",
  builder_url_invalid: "That is not a web link.",
  builder_url_scheme: "A link starts with http or https.",
  builder_url_too_long: "That link is too long.",
  file_required: "Pick a PNG or a JPG.",
  file_too_large: "That image is over 2MB.",
  unsupported_type: "PNG or JPG only.",
  rate_limited: "Too many tries. Wait an hour.",
  not_found: "That tool is gone. Reload the shelf.",
  unauthorized: "Your session ended. Sign in again.",
};

const FIELD_FOR_CODE: Record<string, FieldKey> = {
  title_required: "title",
  title_too_long: "title",
  live_url_required: "live_url",
  live_url_invalid: "live_url",
  live_url_scheme: "live_url",
  live_url_too_long: "live_url",
  blurb_too_long: "blurb",
  section_too_long: "section",
  prompt_too_long: "prompt",
  builder_url_invalid: "builder_url",
  builder_url_scheme: "builder_url",
  builder_url_too_long: "builder_url",
};

function messageFor(err: unknown, fallback: string): string {
  const code = err instanceof ApiError ? err.code : null;
  return (code && MESSAGES[code]) || fallback;
}

function fieldFor(err: unknown): FieldKey | null {
  const code = err instanceof ApiError ? err.code : null;
  return (code && FIELD_FOR_CODE[code]) || null;
}

/**
 * People type shelf.pages.dev without a scheme. The API rejects that, so add
 * the scheme here and write the result back into the input, rather than
 * bouncing them off a validation message for a link that was fine.
 */
function webUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// "The shelf is password." is not a sentence. The pill labels are Title Case
// and wrong mid-prose, so this is its own map.
const VIS_PROSE: Record<Visibility, string> = {
  private: "private",
  unlisted: "unlisted",
  password: "password protected",
  public: "public",
};

const chipClass = (on: boolean) =>
  cn(
    "min-h-[34px] rounded-md border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink",
    on
      ? "border-ink bg-card"
      : "border-line bg-paper hover:border-muted"
  );

export default function ToolDrawer({
  shelfId,
  shelfVisibility,
  tool,
  open,
  onClose,
  onSaved,
  existingSections,
}: ToolDrawerProps) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const [title, setTitle] = useState("");
  const [blurb, setBlurb] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [section, setSection] = useState("");
  const [tag, setTag] = useState<Tag | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [prompt, setPrompt] = useState("");
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [builderUrl, setBuilderUrl] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [shotNote, setShotNote] = useState<string | null>(null);
  const [secretWarning, setSecretWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The row this drawer created in this open session, so a second save
      updates it rather than parking a duplicate on the shelf. */
  const [saved, setSaved] = useState<Tool | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  // Which live_url we have already warned about, so the warning does not
  // reappear and block the second save.
  const warnedUrlRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const hydratedRef = useRef<string | null>(null);

  const current = tool ?? saved;
  const editing = Boolean(current);

  const sections = useMemo(
    () =>
      Array.from(
        new Set(existingSections.map((s) => s.trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [existingSections]
  );

  /* Hydrate on open, and again if the drawer is handed a different tool.
     Keyed on the id, not on the object: onSaved hands the parent a new Tool,
     the parent hands it straight back as a new prop, and re-hydrating on
     identity would wipe the warning that save just raised. */
  useEffect(() => {
    if (!open) {
      hydratedRef.current = null;
      return;
    }
    const key = tool?.id ?? "new";
    if (hydratedRef.current === key) return;
    hydratedRef.current = key;

    setTitle(tool?.title ?? "");
    setBlurb(tool?.blurb ?? "");
    setLiveUrl(tool?.live_url ?? "");
    setSection(tool?.section ?? "");
    setTag(tool?.tag ?? null);
    setVisibility(tool?.visibility ?? "private");
    setPrompt(tool?.prompt ?? "");
    setBuilder(tool?.builder ?? null);
    setBuilderUrl(tool?.builder_url ?? "");
    setFile(null);
    setDragging(false);
    setErrors({});
    setFormError(null);
    setShotNote(null);
    setSecretWarning(false);
    setBusy(false);
    setSaved(null);
  }, [open, tool]);

  /* Local preview, immediately, before anything is uploaded. */
  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* Focus in, scroll locked, focus back to the trigger on the way out. */
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  /* Escape closes, wherever focus happens to be. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const savedShot = current?.screenshot_key ?? null;
  const preview = objectUrl ?? shotUrl(savedShot);
  const selected = VISIBILITIES.find((v) => v.value === visibility) ?? VISIBILITIES[0];
  const anyBlocked = VISIBILITIES.some((v) => RANK[v.value] > RANK[shelfVisibility]);

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes) return;
    const list = Array.from(nodes).filter((node) => node.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function takeFile(picked: File | null | undefined) {
    if (!picked) return;
    const okType =
      /^image\/(png|jpeg)$/i.test(picked.type) || /\.(png|jpe?g)$/i.test(picked.name);
    if (!okType) {
      setErrors((prev) => ({ ...prev, shot: "PNG or JPG only." }));
      return;
    }
    if (picked.size > MAX_SHOT_BYTES) {
      setErrors((prev) => ({ ...prev, shot: "That image is over 2MB." }));
      return;
    }
    setErrors((prev) => ({ ...prev, shot: undefined }));
    setShotNote(null);
    setFile(picked);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    takeFile(event.dataTransfer.files?.[0]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const next: Errors = {};
    const cleanTitle = title.trim();
    if (!cleanTitle) next.title = MESSAGES.title_required;

    const url = webUrl(liveUrl);
    if (!liveUrl.trim()) next.live_url = MESSAGES.live_url_required;
    else if (!url) next.live_url = MESSAGES.live_url_invalid;

    const wantsBuilderUrl = builderUrl.trim().length > 0;
    const bUrl = wantsBuilderUrl ? webUrl(builderUrl) : null;
    if (wantsBuilderUrl && !bUrl) next.builder_url = MESSAGES.builder_url_invalid;

    if (next.title || next.live_url || next.builder_url) {
      // Replace, never merge. `next` is rebuilt each submit and only carries
      // fields that are invalid NOW, so merging leaves a fixed field still
      // showing its old error.
      setErrors(next);
      setFormError(null);
      (next.title ? titleRef : next.live_url ? urlRef : titleRef).current?.focus();
      return;
    }
    if (!url) return;

    const input: ToolInput = {
      title: cleanTitle,
      blurb: blurb.trim() || null,
      live_url: url,
      section: section.trim() || null,
      tag,
      visibility,
      prompt: prompt.trim() || null,
      builder,
      builder_url: bUrl,
    };

    setBusy(true);
    setErrors({});
    setFormError(null);
    setShotNote(null);
    setSecretWarning(false);

    try {
      const existing = tool ?? saved;
      const res = existing
        ? await api.updateTool(existing.id, input)
        : await api.createTool({ ...input, shelf_id: shelfId });

      let row = res.tool;
      let shotFailed = false;

      // The upload needs an id, so on create the row is written first and the
      // screenshot follows it.
      if (file) {
        try {
          row = (await api.uploadShot(row.id, file)).tool;
          setFile(null);
        } catch (err) {
          shotFailed = true;
          setShotNote(
            messageFor(err, "The tool is saved. The screenshot did not upload.")
          );
        }
      }

      setSaved(row);
      setLiveUrl(row.live_url);
      setBuilderUrl(row.builder_url ?? "");
      setVisibility(row.visibility);
      onSaved(row);

      // secret_warning is a pure function of the saved URL, so it comes back
      // identically on every later save of the same link. Warning again and
      // refusing to close would leave the primary button unable to finish the
      // flow. Warn once per URL, then let the next save through.
      if (res.secret_warning && warnedUrlRef.current !== row.live_url) {
        warnedUrlRef.current = row.live_url;
        setSecretWarning(true);
      } else if (!shotFailed) {
        onClose();
      }
    } catch (err) {
      const message = messageFor(err, "That did not save. Try again.");
      const field = fieldFor(err);
      if (field) {
        setErrors((prev) => ({ ...prev, [field]: message }));
        (field === "title" ? titleRef : urlRef).current?.focus();
      } else {
        setFormError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const describe = (key: FieldKey) => (errors[key] ? id(`${key}-error`) : undefined);

  /* A function, not a component: a component declared in here would remount
     its paragraph on every keystroke. */
  const fieldError = (name: FieldKey) =>
    errors[name] ? (
      <p id={id(`${name}-error`)} role="alert" className="mt-1.5 text-[13px] text-rust">
        {errors[name]}
      </p>
    ) : null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-ink/22"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("heading")}
        onKeyDown={trapTab}
        className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col border-l border-line bg-card shadow-[-18px_0_44px_rgba(28,25,20,0.14)]"
      >
        <form onSubmit={submit} noValidate className="flex h-full min-h-0 flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-8 pb-5 pt-7">
            <h2
              id={id("heading")}
              className="font-display text-[27px] font-medium tracking-[-0.01em]"
            >
              Title. One sentence. Link.
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2.5 -mt-1.5 flex size-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            >
              <X size={18} strokeWidth={1.6} aria-hidden />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-[26px]">
            {/* Every visible label here is a Field, which draws a div. The
                sr-only label is the real one the control is tied to. */}

            {/* 1. Title */}
            <div>
              <label htmlFor={id("title")} className="sr-only">
                Title
              </label>
              <Field label="Title">
                <input
                  id={id("title")}
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  aria-invalid={Boolean(errors.title)}
                  aria-describedby={describe("title")}
                  className={cn(inputClass, errors.title && "border-rust")}
                />
              </Field>
              {fieldError("title")}
            </div>

            {/* 2. One sentence */}
            <div>
              <label htmlFor={id("blurb")} className="sr-only">
                One sentence
              </label>
              <Field label="One sentence">
                <input
                  id={id("blurb")}
                  value={blurb}
                  onChange={(e) => setBlurb(e.target.value)}
                  maxLength={280}
                  placeholder="What it does, in one line."
                  aria-invalid={Boolean(errors.blurb)}
                  aria-describedby={describe("blurb")}
                  className={cn(inputClass, errors.blurb && "border-rust")}
                />
              </Field>
              {fieldError("blurb")}
            </div>

            {/* 3. Live URL */}
            <div>
              <label htmlFor={id("live_url")} className="sr-only">
                Live URL
              </label>
              <Field label="Live URL">
                <input
                  id={id("live_url")}
                  ref={urlRef}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  placeholder="https://the-thing.pages.dev"
                  aria-invalid={Boolean(errors.live_url)}
                  aria-describedby={describe("live_url")}
                  className={cn(inputClass, errors.live_url && "border-rust")}
                />
              </Field>
              {fieldError("live_url")}

              {secretWarning && (
                <div
                  role="alert"
                  className="mt-2.5 flex gap-2.5 rounded-md border border-amber/40 bg-paper px-3 py-2.5"
                >
                  <TriangleAlert
                    size={16}
                    strokeWidth={1.6}
                    aria-hidden
                    className="mt-[3px] shrink-0 text-amber"
                  />
                  <p className="text-[13px] leading-[1.55] text-amber">
                    That link has something like a key in it. Anyone with the link
                    can see it.
                  </p>
                </div>
              )}
            </div>

            {/* 4. Screenshot */}
            <div>
              <Field label="Screenshot">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  aria-label={
                    preview
                      ? "Replace the screenshot. PNG or JPG, up to 2MB."
                      : "Add a screenshot. PNG or JPG, up to 2MB."
                  }
                  aria-describedby={describe("shot")}
                  className={cn(
                    "flex h-[104px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-md border border-dashed bg-paper transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink",
                    dragging ? "border-ink" : "border-line",
                    errors.shot && "border-rust"
                  )}
                >
                  {preview ? (
                    <img
                      src={preview}
                      alt="Screenshot preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <>
                      <ImageIcon
                        size={18}
                        strokeWidth={1.6}
                        aria-hidden
                        className="text-muted"
                      />
                      <span className="text-sm text-muted">Drop a PNG or JPG</span>
                    </>
                  )}
                </button>
              </Field>

              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                tabIndex={-1}
                aria-hidden
                className="hidden"
                onChange={(e) => {
                  takeFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />

              {file && (
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="mt-1 py-2 text-[13px] text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
                >
                  Remove
                </button>
              )}
              {fieldError("shot")}
              {shotNote && (
                <p aria-live="polite" className="mt-1.5 text-[13px] text-rust">
                  {shotNote}
                </p>
              )}
            </div>

            {/* 5. Section */}
            <div>
              <label htmlFor={id("section")} className="sr-only">
                Section
              </label>
              <Field label="Section">
                <div className="relative">
                  <input
                    id={id("section")}
                    list={id("sections")}
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    maxLength={60}
                    autoComplete="off"
                    placeholder="Back office"
                    aria-invalid={Boolean(errors.section)}
                    aria-describedby={describe("section")}
                    className={cn(inputClass, "pr-10", errors.section && "border-rust")}
                  />
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    aria-hidden
                    className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <datalist id={id("sections")}>
                    {sections.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
              </Field>
              {fieldError("section")}
            </div>

            {/* 6. Tag */}
            <Field label="Tag">
              <div role="group" aria-label="Tag" className="flex flex-wrap gap-2">
                {TAGS.map((t) => {
                  const on = tag === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTag(on ? null : t.value)}
                      className={chipClass(on)}
                    >
                      <Meta className={on ? "text-ink" : undefined}>{t.label}</Meta>
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* 7. Visibility */}
            <Field label="Visibility">
              <div
                role="radiogroup"
                aria-label="Visibility"
                className="flex overflow-hidden rounded-md border border-line bg-paper"
              >
                {VISIBILITIES.map((v) => {
                  const blocked = RANK[v.value] > RANK[shelfVisibility];
                  const on = visibility === v.value;
                  return (
                    <label
                      key={v.value}
                      className={cn(
                        "flex flex-1 items-stretch",
                        blocked ? "cursor-not-allowed" : "cursor-pointer"
                      )}
                    >
                      <input
                        type="radio"
                        name={id("visibility")}
                        value={v.value}
                        checked={on}
                        disabled={blocked}
                        onChange={() => setVisibility(v.value)}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "w-full py-[11px] text-center text-[13px] transition-colors peer-focus-visible:ring-1 peer-focus-visible:ring-inset peer-focus-visible:ring-ink",
                          on ? "bg-ink text-card" : "text-muted",
                          !on && !blocked && "hover:text-ink",
                          blocked && "text-muted/40"
                        )}
                      >
                        {v.label}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p aria-live="polite" className="mt-[7px] text-[13px] text-muted">
                {selected.line}
              </p>
              {anyBlocked && (
                <p className="mt-1.5 text-[13px] text-muted">
                  The shelf is {VIS_PROSE[shelfVisibility]}. A tool cannot be more visible than
                  its shelf.
                </p>
              )}
            </Field>

            {/* 8. Prompt pocket */}
            <div>
              <label htmlFor={id("prompt")} className="sr-only">
                Prompt pocket
              </label>
              <Field label="Prompt pocket">
                <textarea
                  id={id("prompt")}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={20000}
                  rows={6}
                  placeholder="Paste the prompt. Future you will want it."
                  aria-invalid={Boolean(errors.prompt)}
                  aria-describedby={describe("prompt")}
                  className={cn(
                    inputClass,
                    "h-auto min-h-[132px] resize-y py-3 font-mono text-[13px] leading-[1.6]",
                    errors.prompt && "border-rust"
                  )}
                />
              </Field>
              {fieldError("prompt")}
            </div>

            {/* 9. Builder */}
            <Field label="Builder">
              <div role="group" aria-label="Builder" className="flex flex-wrap gap-2">
                {BUILDERS.map((b) => {
                  const on = builder === b.value;
                  return (
                    <button
                      key={b.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setBuilder(on ? null : b.value)}
                      className={chipClass(on)}
                    >
                      <Meta className={on ? "text-ink" : undefined}>{b.label}</Meta>
                    </button>
                  );
                })}
              </div>
            </Field>

            <div>
              <label htmlFor={id("builder_url")} className="sr-only">
                Builder link
              </label>
              <Field label="Builder link">
                <input
                  id={id("builder_url")}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={builderUrl}
                  onChange={(e) => setBuilderUrl(e.target.value)}
                  placeholder="Where you edit it. Only you see this."
                  aria-invalid={Boolean(errors.builder_url)}
                  aria-describedby={describe("builder_url")}
                  className={cn(inputClass, errors.builder_url && "border-rust")}
                />
              </Field>
              {fieldError("builder_url")}
            </div>
          </div>

          <div className="border-t border-line px-8 pb-7 pt-5">
            {formError && (
              <p role="alert" className="mb-3 text-[13px] text-rust">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={busy} className="h-12 w-full text-base">
              {busy ? "Saving..." : editing ? "Save" : "Put it on the shelf"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
