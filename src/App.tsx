import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter, Routes, Route, Navigate, useLocation, useParams, useNavigate,
} from "react-router-dom";
import { api } from "@/lib/api";
import type { Me, Shelf, Tool } from "@/lib/types";
import Login from "@/pages/Login";
import ShelvesList from "@/pages/ShelvesList";
import ShelfGrid from "@/pages/ShelfGrid";
import ToolDetail from "@/pages/ToolDetail";
import ToolDrawer from "@/components/ToolDrawer";
import ClientShelf from "@/pages/ClientShelf";
import ClientToolDetail from "@/pages/ClientToolDetail";

type Auth = { state: "loading" } | { state: "out" } | { state: "in"; me: Me };

function useAuth(): Auth {
  const [auth, setAuth] = useState<Auth>({ state: "loading" });
  useEffect(() => {
    api.me()
      .then(({ user }) => setAuth({ state: "in", me: user }))
      .catch(() => setAuth({ state: "out" }));
  }, []);
  return auth;
}

/** The only copy a stranger ever gets. No search box, no home link. */
function Closed() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">
        This shelf is closed.
      </h1>
    </main>
  );
}

function RequireAuth({ auth, children }: { auth: Auth; children: React.ReactNode }) {
  const location = useLocation();
  if (auth.state === "loading") return null;
  if (auth.state === "out")
    return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

/**
 * Owns the seam between the grid and the drawer. ShelfGrid raises intent
 * (add or edit) and this decides what the drawer does with it, so neither
 * file has to know about the other.
 */
function ShelfRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const [drawer, setDrawer] = useState<{ open: boolean; tool?: Tool }>({ open: false });
  const [reloadKey, setReloadKey] = useState(0);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [sections, setSections] = useState<string[]>([]);

  useEffect(() => {
    api.getShelf(id)
      .then(({ shelf: s, tools }) => {
        setShelf(s);
        setSections([...new Set(tools.map((t) => t.section).filter((x): x is string => !!x))]);
      })
      .catch(() => setShelf(null));
  }, [id, reloadKey]);

  const onSaved = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <>
      <ShelfGrid
        key={reloadKey}
        shelfId={id}
        onAddTool={() => setDrawer({ open: true })}
        onEditTool={(tool) => setDrawer({ open: true, tool })}
      />
      {shelf && (
        <ToolDrawer
          shelfId={id}
          shelfVisibility={shelf.visibility}
          tool={drawer.tool}
          open={drawer.open}
          existingSections={sections}
          onClose={() => setDrawer({ open: false })}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

/** ToolDetail takes a loaded tool rather than fetching, so the route loads it. */
function ToolDetailRoute() {
  const { shelfId = "", toolId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{ shelf: Shelf; tool: Tool } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    api.getShelf(shelfId)
      .then(({ shelf, tools }) => {
        if (!live) return;
        const tool = tools.find((t) => t.id === toolId);
        if (tool) setData({ shelf, tool });
        else setMissing(true);
      })
      .catch(() => live && setMissing(true));
    return () => { live = false; };
  }, [shelfId, toolId]);

  if (missing) return <Closed />;
  if (!data) return null;

  return (
    <ToolDetail
      tool={data.tool}
      shelf={data.shelf}
      onChanged={(t) => {
        setData((d) => (d ? { ...d, tool: t } : d));
        if (t.id !== toolId) navigate(`/app/${shelfId}/${t.id}`, { replace: true });
      }}
    />
  );
}

export default function App() {
  const auth = useAuth();
  const home = auth.state === "in" ? "/app" : "/login";

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route
          path="/login"
          element={auth.state === "in" ? <Navigate to="/app" replace /> : <Login />}
        />

        <Route
          path="/app"
          element={
            <RequireAuth auth={auth}>
              {auth.state === "in" && <ShelvesList me={auth.me} />}
            </RequireAuth>
          }
        />
        <Route
          path="/app/:id"
          element={<RequireAuth auth={auth}><ShelfRoute /></RequireAuth>}
        />
        <Route
          path="/app/:shelfId/:toolId"
          element={<RequireAuth auth={auth}><ToolDetailRoute /></RequireAuth>}
        />

        {/* No session anywhere below. These render for a client with no account. */}
        <Route path="/s/:slug" element={<ClientShelf />} />
        <Route path="/s/:slug/:toolId" element={<ClientToolDetail />} />

        <Route path="*" element={<Closed />} />
      </Routes>
    </BrowserRouter>
  );
}
