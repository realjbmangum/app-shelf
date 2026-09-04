/**
 * The stack registry.
 *
 * `tools.stack` stays a plain comma or newline separated string, so it is
 * still a text field anyone can type into. This file turns that string into
 * structured items with a mark and a category. Anything unrecognised still
 * renders, as a plain chip: the field must never punish you for typing
 * something new.
 *
 * The marks are drawn here rather than fetched. A client shelf must not
 * phone a third party for an asset, and the CSP would block it anyway.
 * They are simplified marks, not official brand assets.
 */
export type StackCategory = "Front end" | "Back end" | "Data" | "Hosting" | "Also";

export type StackItem = {
  name: string;
  category: StackCategory;
  /** 20x20 viewBox path data. */
  mark?: string;
  /** Filled marks need no stroke. */
  filled?: boolean;
};

const REG: Record<string, StackItem> = {};
const add = (
  keys: string[],
  name: string,
  category: StackCategory,
  mark?: string,
  filled?: boolean
) => {
  for (const k of keys) REG[k] = { name, category, mark, filled };
};

/* ---- Front end ---- */
add(["astro"], "Astro", "Front end",
  "M7.2 14.6c-.5-1.6-.2-3 .8-3.9.2 1 .9 1.6 1.9 1.8 1.5.3 2.3-.5 2.5-1.4.6.7.9 1.6.9 2.6 0 2.1-1.4 3.6-3.1 3.6s-2.7-1-3-2.7ZM10 1.5 6.1 12.3h1.6L10 5.4l2.3 6.9h1.6L10 1.5Z", true);
add(["tailwind","tailwind css","tailwindcss"], "Tailwind CSS", "Front end",
  "M10 4c-2.2 0-3.6 1.1-4.2 3.3.8-1.1 1.8-1.5 2.9-1.2.6.2 1.1.7 1.6 1.2.8.9 1.8 1.9 3.9 1.9 2.2 0 3.6-1.1 4.2-3.3-.8 1.1-1.8 1.5-2.9 1.2-.6-.2-1.1-.7-1.6-1.2C13.1 5 12.1 4 10 4ZM5.8 9.2c-2.2 0-3.6 1.1-4.2 3.3.8-1.1 1.8-1.5 2.9-1.2.6.2 1.1.7 1.6 1.2.8.9 1.8 1.9 3.9 1.9 2.2 0 3.6-1.1 4.2-3.3-.8 1.1-1.8 1.5-2.9 1.2-.6-.2-1.1-.7-1.6-1.2-.8-.9-1.8-1.9-3.9-1.9Z", true);
add(["react"], "React", "Front end",
  "M10 11.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Z M10 14.4c-4.4 0-8-2-8-4.4s3.6-4.4 8-4.4 8 2 8 4.4-3.6 4.4-8 4.4Z M6.1 12.2C3.9 8.4 3.4 4.4 5.5 3.2c2.1-1.2 5.3 1.3 7.5 5.1 2.2 3.8 2.7 7.8.6 9-2.1 1.2-5.3-1.3-7.5-5.1Z M13.9 12.2c-2.2 3.8-5.4 6.3-7.5 5.1-2.1-1.2-1.6-5.2.6-9 2.2-3.8 5.4-6.3 7.5-5.1 2.1 1.2 1.6 5.2-.6 9Z");
add(["typescript","ts"], "TypeScript", "Front end",
  "M2.5 2.5h15v15h-15z M6 9.2h5.5 M8.75 9.2v6 M13 15c.5.4 1.2.6 1.9.6 1.2 0 2-.6 2-1.5 0-1.8-3.6-1.3-3.6-3.2 0-.9.8-1.6 2-1.6.6 0 1.2.2 1.6.5");
add(["vite"], "Vite", "Front end",
  "M10 2.5 17.5 6l-1.4 8.5L10 17.5 3.9 14.5 2.5 6 10 2.5Z M10 6.5 7.5 11h2l-.7 3.2L12 9.5h-2l.5-3Z");
add(["html","css","html and css"], "HTML and CSS", "Front end",
  "M3.5 3h13l-1.2 12.5L10 17.5l-5.3-2L3.5 3Z M7 7h6.5 M7 10.5h6.5 M7 14h4");
add(["javascript","js","vanilla js"], "JavaScript", "Front end",
  "M2.5 2.5h15v15h-15z M8.2 9v5.2c0 .9-.5 1.4-1.3 1.4-.6 0-1-.3-1.3-.8 M11 14.4c.4.6 1 .9 1.8.9 1 0 1.7-.5 1.7-1.3 0-1.6-3.2-1.1-3.2-2.9 0-.8.7-1.4 1.7-1.4.6 0 1.1.2 1.4.6");

/* ---- Back end ---- */
add(["cloudflare workers","workers","worker"], "Cloudflare Workers", "Back end",
  "M10.5 3 6 10.8h3.3L8.5 17l5.5-8.2h-3.3L10.5 3Z", true);
add(["hono"], "Hono", "Back end",
  "M10 2.5c2.5 3 5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 2.5-6 5-9Z M10 17.5a2.5 2.5 0 0 0 2.5-2.5c0-1.5-1.2-2.5-2.5-4.5-1.3 2-2.5 3-2.5 4.5A2.5 2.5 0 0 0 10 17.5Z");
add(["cloudflare access","access","zero trust"], "Cloudflare Access", "Back end",
  "M10 2.5 3.5 5v5.2c0 3.4 2.7 6.4 6.5 7.3 3.8-.9 6.5-3.9 6.5-7.3V5L10 2.5Z M7.8 10 9.4 11.6 12.5 8.5");
add(["build script","static build"], "Static build", "Back end",
  "M4 5h12 M4 10h12 M4 15h7 M17 13.5l-2.5 2.5");

/* ---- Data ---- */
add(["d1","cloudflare d1"], "Cloudflare D1", "Data",
  "M10 6.2c3 0 5.5-.9 5.5-2s-2.5-2-5.5-2-5.5.9-5.5 2 2.5 2 5.5 2Z M4.5 4.2v11.6c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4.2 M4.5 10c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2");
add(["r2","cloudflare r2"], "Cloudflare R2", "Data",
  "M10 2.5 17 6.2v7.6L10 17.5 3 13.8V6.2L10 2.5Z M3 6.2 10 10l7-3.8 M10 10v7.5");
add(["kv","cloudflare kv","workers kv"], "Workers KV", "Data",
  "M12.5 3a4.5 4.5 0 0 0-4.3 5.8L3 14v3h3l.8-1.7H8.5v-1.7h1.7l1.5-1.5A4.5 4.5 0 1 0 12.5 3Z M13.6 6.9h.01");
add(["sqlite"], "SQLite", "Data",
  "M10 6.2c3 0 5.5-.9 5.5-2s-2.5-2-5.5-2-5.5.9-5.5 2 2.5 2 5.5 2Z M4.5 4.2v11.6c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4.2");

/* ---- Hosting ---- */
add(["cloudflare pages","pages"], "Cloudflare Pages", "Hosting",
  "M14.6 15.5H6a4 4 0 1 1 .8-7.9A5 5 0 0 1 16 9.3a3.1 3.1 0 0 1-1.4 6.2Z M7.5 12h6");
add(["cloudflare"], "Cloudflare", "Hosting",
  "M14.6 15.5H6a4 4 0 1 1 .8-7.9A5 5 0 0 1 16 9.3a3.1 3.1 0 0 1-1.4 6.2Z");
add(["wrangler"], "Wrangler", "Hosting",
  "M4 16l4.5-4.5 M7.5 8.5 11 5a3 3 0 1 1 4 4l-3.5 3.5-4-4Z M3.5 16.5h2v-2");

const norm = (s: string) => s.trim().toLowerCase().replace(/\.$/, "");

/** Free text in, structured items out. Unknown names survive as plain chips. */
export function parseStack(stack: string | null | undefined): StackItem[] {
  if (!stack) return [];
  const seen = new Set<string>();
  const out: StackItem[] = [];
  for (const raw of stack.split(/[,\n;]/)) {
    const key = norm(raw);
    if (!key) continue;
    const hit = REG[key];
    const item: StackItem = hit ?? { name: raw.trim(), category: "Also" };
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}

export const CATEGORY_ORDER: StackCategory[] = ["Front end", "Back end", "Data", "Hosting", "Also"];

export function groupStack(items: StackItem[]): [StackCategory, StackItem[]][] {
  return CATEGORY_ORDER.map(
    (c) => [c, items.filter((i) => i.category === c)] as [StackCategory, StackItem[]]
  ).filter(([, items]) => items.length > 0);
}
