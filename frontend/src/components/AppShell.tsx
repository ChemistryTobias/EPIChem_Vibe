/**
 * NavRail + main column. Screens render their own header and body inside it.
 *
 * Doubles as the auth gate. Only two things send you to the login form: no
 * stored token, or a 401 (which the client clears the token on). Anything
 * else — the backend being down, a 500, a dev-server restart mid-request —
 * is a *reachability* problem, not a sign-out, and says so instead. Treating
 * every failure as "signed out" made a brief blip look like a logout and
 * threw away a perfectly good token.
 */

import { Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ApiError, getToken } from "../api/client";
import { me } from "../api/auth";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { LoginScreen } from "./LoginScreen";
import { NavRail } from "./NavRail";

import "./AppShell.css";

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

export function AppShell() {
  const token = getToken();

  const session = useQuery({
    queryKey: ["me"],
    queryFn: me,
    enabled: token !== null,
    // A 401 is final; a network blip is worth one more go.
    retry: (attempts, error) => !isUnauthorized(error) && attempts < 2,
  });

  if (token === null) return <LoginScreen />;
  if (session.isPending) return <div className="shell__booting label">Loading…</div>;

  if (session.isError) {
    if (isUnauthorized(session.error)) return <LoginScreen />;
    return (
      <div className="shell__booting">
        <Alert kind="error">{session.error.message}</Alert>
        <p>
          <Button onClick={() => session.refetch()}>Retry</Button>
        </p>
      </div>
    );
  }

  return (
    <div className="shell">
      <NavRail user={session.data.name} />
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
