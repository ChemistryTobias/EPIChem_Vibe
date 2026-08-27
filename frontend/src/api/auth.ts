/** Login / logout against `backend/app/core/access_control/`. */

import { apiGet, apiPost, setToken } from "./client";

interface TokenResponse {
  access_token: string;
  token_type: string;
}

export async function login(name: string, password: string): Promise<void> {
  const { access_token } = await apiPost<TokenResponse>("/auth/login", { name, password });
  setToken(access_token);
}

export async function logout(): Promise<void> {
  try {
    await apiPost<void>("/auth/logout", undefined);
  } finally {
    setToken(null);
  }
}

/** `GET /auth/me` returns a plain `{uuid, name}`, not the full User schema. */
export const me = () => apiGet<{ uuid: string; name: string }>("/auth/me");
