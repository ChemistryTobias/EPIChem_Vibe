/**
 * Sign-in. Every backend route except this one and `POST /users` needs a
 * bearer token, so nothing renders until it succeeds.
 *
 * There is no sign-up here on purpose: `POST /users` is a bootstrap route for
 * creating the first account, not self-service registration.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { login } from "../api/auth";
import { Alert } from "./Alert";
import { Button } from "./Button";

import "./LoginScreen.css";

export function LoginScreen() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(name, password);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <h1 className="login__wordmark">EPICHEM</h1>

        <label className="login__field">
          <span className="label">Username</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>

        <label className="login__field">
          <span className="label">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <Alert kind="error">{error}</Alert>}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <p className="login__note muted">
          Accounts are created by an administrator via the API — see docs/API.md.
        </p>
      </form>
    </div>
  );
}
