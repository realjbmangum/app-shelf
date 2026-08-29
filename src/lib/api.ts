import type {
  Me, Shelf, ShelfListItem, Tool, RollUp,
  PublicShelf, PublicToolDetail, Section, Snapshot, Visibility, Tag, Builder,
} from "./types";

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? (init?.headers ?? {})
        : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `http_${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

const post = <T>(p: string, body?: unknown) =>
  req<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) =>
  req<T>(p, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(p: string) => req<T>(p, { method: "DELETE" });

export type ShelfInput = Partial<
  Pick<Shelf, "title" | "blurb" | "client_name" | "accent" | "visibility" | "sort_order">
> & { passphrase?: string };

export type ToolInput = Partial<
  Pick<Tool, "title" | "blurb" | "live_url" | "section" | "tag" | "visibility" |
             "sort_order" | "status" | "prompt" | "builder" | "builder_url">
>;

export const api = {
  // auth
  me: () => req<{ user: Me }>("/api/me"),
  sendMagicLink: (email: string) => post<{ ok: true }>("/api/auth/magic", { email }),
  logout: () => post<{ ok: true }>("/api/auth/logout"),

  // shelves
  listShelves: () => req<{ shelves: ShelfListItem[] }>("/api/shelves"),
  getShelf: (id: string) =>
    req<{ shelf: Shelf; tools: Tool[]; status: RollUp }>(`/api/shelves/${id}`),
  createShelf: (input: ShelfInput) => post<{ shelf: Shelf }>("/api/shelves", input),
  updateShelf: (id: string, input: ShelfInput) =>
    patch<{ shelf: Shelf; reclamped: number }>(`/api/shelves/${id}`, input),
  deleteShelf: (id: string) => del<{ ok: true }>(`/api/shelves/${id}`),
  uploadLogo: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ logo_key: string; updated_at: number }>(`/api/shelves/${id}/logo`, {
      method: "POST",
      body: fd,
    });
  },

  // tools
  createTool: (input: ToolInput & { shelf_id: string }) =>
    post<{ tool: Tool; secret_warning: boolean }>("/api/tools", input),
  updateTool: (id: string, input: ToolInput) =>
    patch<{ tool: Tool; secret_warning: boolean }>(`/api/tools/${id}`, input),
  deleteTool: (id: string) => del<{ ok: true }>(`/api/tools/${id}`),
  reorderTools: (shelf_id: string, ids: string[]) =>
    post<{ ok: true; count: number }>("/api/tools/reorder", { shelf_id, ids }),
  uploadShot: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ ok: true; tool: Tool }>(`/api/tools/${id}/shot`, {
      method: "POST",
      body: fd,
    });
  },

  // memory
  versions: (id: string) =>
    req<{ current_version: number; live_version: number | null; versions: Snapshot[] }>(
      `/api/tools/${id}/versions`
    ),
  snapshot: (id: string, note?: string) =>
    post<{ ok: true; version: number }>(`/api/tools/${id}/snapshot`, { note }),
  makeLive: (id: string, version: number) =>
    post<{ ok: true; version: number; live_url: string; prompt: string | null; confirmed_at: number }>(
      `/api/tools/${id}/make-live`,
      { version }
    ),
  /** "Still true". Re-dates confirmed_at and changes nothing else. */
  confirm: (id: string) =>
    post<{ ok: true; confirmed_at: number }>(`/api/tools/${id}/confirm`),
  ping: (id: string) =>
    post<{ id: string; status: string; code: number | null; reason: string | null; checked_at: number }>(
      `/api/tools/${id}/ping`
    ),

  // public, no session
  publicShelf: (slug: string) =>
    req<{ locked?: true; title?: string; shelf: PublicShelf; sections: Section[] }>(
      `/api/s/${encodeURIComponent(slug)}`
    ),
  publicTool: (slug: string, toolId: string) =>
    req<{ shelf: PublicShelf; tool: PublicToolDetail }>(
      `/api/s/${encodeURIComponent(slug)}/${toolId}`
    ),
  unlock: (slug: string, passphrase: string) =>
    post<{ ok: true }>(`/api/s/${encodeURIComponent(slug)}/unlock`, { passphrase }),
};

export type { Visibility, Tag, Builder };
