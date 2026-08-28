import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { api, type Me } from "@/lib/api";
import Login from "@/pages/Login";
import AppHome from "@/pages/AppHome";

type Auth = { state: "loading" } | { state: "out" } | { state: "in"; me: Me };

function useAuth(): Auth {
  const [auth, setAuth] = useState<Auth>({ state: "loading" });
  useEffect(() => {
    api
      .me()
      .then(({ user }) => setAuth({ state: "in", me: user }))
      .catch(() => setAuth({ state: "out" }));
  }, []);
  return auth;
}

function Protected({ auth }: { auth: Auth }) {
  const location = useLocation();
  if (auth.state === "loading") return null;
  if (auth.state === "out")
    return <Navigate to="/login" replace state={{ from: location }} />;
  return <AppHome me={auth.me} />;
}

function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="font-display text-3xl font-medium tracking-tight">
        This shelf is closed.
      </h1>
    </main>
  );
}

export default function App() {
  const auth = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            auth.state === "in" ? (
              <Navigate to="/app" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/login"
          element={
            auth.state === "in" ? <Navigate to="/app" replace /> : <Login />
          }
        />
        <Route path="/app" element={<Protected auth={auth} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
