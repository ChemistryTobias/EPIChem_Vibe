/**
 * NavRail + main column. Screens render their own header and body inside it.
 *
 * Doubles as the auth gate: every backend route needs a bearer token, so
 * `GET /auth/me` decides whether to show the app or the login form. The
 * client clears the token on any 401, so an expired session lands here too.
 */

import { Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { me } from "../api/auth";
import { LoginScreen } from "./LoginScreen";
import { NavRail } from "./NavRail";

import "./AppShell.css";

export function AppShell() {
  const session = useQuery({ queryKey: ["me"], queryFn: me, retry: false });

  if (session.isLoading) return <div className="shell__booting label">Loading…</div>;
  if (session.isError || !session.data) return <LoginScreen />;

  return (
    <div className="shell">
      <NavRail user={session.data.name} />
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
