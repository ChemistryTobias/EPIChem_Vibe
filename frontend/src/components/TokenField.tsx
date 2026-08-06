/**
 * The entire UI for the API token: one password field in the sidebar footer.
 *
 * This is not a login. The backend's auth is a shared bearer token — no
 * users, no sessions, no roles (see `backend/epichem/api/auth.py`, which is
 * explicit that a real identity system is still owed). Building a login
 * screen on top of a shared secret would misrepresent what it is.
 *
 * It exists because without it, a backend running with EPICHEM_API_TOKENS
 * set would leave the console able to read everything and write nothing,
 * with no way to fix that short of the devtools console.
 */

import { useState } from "react";

import { getApiToken, setApiToken } from "../api/client";

import "./TokenField.css";

export function TokenField() {
  const [token, setToken] = useState(getApiToken);
  const [saved, setSaved] = useState(false);

  function save(value: string) {
    setToken(value);
    setApiToken(value);
    setSaved(true);
  }

  return (
    <div className="token-field">
      <label className="label" htmlFor="api-token">
        API token
      </label>
      <input
        id="api-token"
        type="password"
        value={token}
        placeholder="only needed for writes"
        autoComplete="off"
        onChange={(e) => save(e.target.value)}
        onBlur={() => setSaved(false)}
      />
      <p className="token-field__hint">
        {saved
          ? "Stored in this browser."
          : "Needed only if the backend sets EPICHEM_API_TOKENS."}
      </p>
    </div>
  );
}
