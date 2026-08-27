/**
 * The one place this app talks to the network.
 *
 * Requests go to a relative `/api/v1/...` URL, which the Vite dev server
 * proxies to the FastAPI backend — so the browser only sees one origin and
 * no CORS is involved. Every endpoint needs a bearer token except
 * `POST /auth/login` and `POST /users` (the bootstrap path).
 */

const API_BASE = "/api/v1";
const TOKEN_KEY = "epichem.token";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private-mode browsers can throw; the request will 401 and say so
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function toError(response: Response): Promise<ApiError> {
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const body = await response.json();
    if (body?.detail) {
      message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    // non-JSON error body — the status line is all we have
  }
  return new ApiError(response.status, message);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the EPIChem API — is the backend running on :8000?");
  }

  // A revoked or expired token should not keep failing silently on every
  // later call; drop it so the app falls back to the login screen.
  if (response.status === 401) {
    setToken(null);
    throw new ApiError(401, "Not signed in");
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body: unknown) => request<T>("POST", path, body);
export const apiPatch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
export const apiDelete = (path: string) => request<void>("DELETE", path);
