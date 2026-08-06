/**
 * The one place this app talks to the network.
 *
 * Requests go to a relative `/api/...` URL, which the Vite dev server proxies
 * to the FastAPI backend (see vite.config.ts) — so the browser only ever sees
 * one origin and no CORS is involved in development.
 *
 * The backend reports its own errors as RFC 9457 problem+json
 * (`backend/epichem/api/errors.py`), so failures are unwrapped into an
 * `ApiError` carrying the problem's `title`/`detail`. That is what screens
 * show the user — never a bare "request failed".
 */

export const API_BASE = "/api/v1";

/**
 * Where the API token lives.
 *
 * localStorage, not a build-time env var: a token baked into the bundle
 * would be shipped to everyone who loads the page. Not a cookie/session
 * either — the backend's auth is a shared bearer token (ADR-less, see
 * `backend/epichem/api/auth.py`), there is no user, and there is no login
 * flow to build one on. `TokenField` in the sidebar is the whole UI for it.
 *
 * Reads never need it. Writes need it only when the backend has
 * EPICHEM_API_TOKENS set; with the variable unset, this stays empty and
 * nothing changes.
 */
const TOKEN_STORAGE_KEY = "epichem.apiToken";

export function getApiToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return ""; // private-mode browsers can throw on localStorage access
  }
}

export function setApiToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Nothing useful to do; the request will 401 and say so.
  }
}

/** RFC 9457 Problem Details. */
interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
}

export class ApiError extends Error {
  readonly status: number;
  /** The problem's `detail`, when the backend sent one. */
  readonly detail: string | null;

  constructor(status: number, title: string, detail: string | null) {
    super(detail ? `${title}: ${detail}` : title);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let title = `${response.status} ${response.statusText}`.trim();
  let detail: string | null = null;
  try {
    const body = (await response.json()) as Problem | { detail?: unknown };
    if (body && typeof body === "object") {
      if ("title" in body && typeof body.title === "string") title = body.title;
      // problem+json uses `detail: string`; FastAPI's own validation errors
      // use `detail: [...]`, which is only useful stringified.
      if ("detail" in body && body.detail != null) {
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      }
    }
  } catch {
    // Non-JSON error body (a proxy error page, say) — the status line is all we have.
  }
  return new ApiError(response.status, title, detail);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getApiToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects when the request never got an HTTP response —
    // backend down, or the dev-server proxy can't reach it.
    throw new ApiError(
      0,
      "Cannot reach the EPIChem API",
      "Is the backend running on :8000? (uvicorn epichem.api.app:app --reload)",
    );
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Build a query string from a plain filter object, dropping keys whose value
 * is undefined or "" — so "no filter selected" simply doesn't appear in the
 * URL rather than being sent as an empty match.
 */
export function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body: unknown) => request<T>("POST", path, body);
export const apiPut = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
export const apiDelete = (path: string) => request<void>("DELETE", path);
