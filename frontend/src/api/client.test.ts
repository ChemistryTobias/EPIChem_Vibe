/**
 * The API client is the other place worth testing: it's the only thing that
 * touches the network, and its error path — unwrapping RFC 9457
 * problem+json into something a screen can show — is what stands between a
 * failed write and a blank panel.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  ApiError,
  apiDelete,
  apiGet,
  apiGetPage,
  apiPost,
  getApiToken,
  query,
  setApiToken,
} from "./client";

/**
 * Await a request that must fail, and hand back the ApiError. Doubles as an
 * assertion that it rejected at all — `.catch(e => e)` would silently pass
 * if the request unexpectedly succeeded.
 */
async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (cause) {
    return cause as ApiError;
  }
  throw new Error("expected the request to reject, but it resolved");
}

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => ({}),
    ...response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("query", () => {
  test("drops undefined and empty values so unset filters don't reach the API", () => {
    expect(query({ state: "staged", owner: undefined, q: "" })).toBe("?state=staged");
  });

  test("returns an empty string when nothing is set", () => {
    expect(query({ a: undefined, b: "" })).toBe("");
  });

  test("encodes values", () => {
    expect(query({ q: "a b&c" })).toBe("?q=a+b%26c");
  });

  test("stringifies numbers, so limit/offset can be passed as numbers", () => {
    expect(query({ limit: 50, offset: 0 })).toBe("?limit=50&offset=0");
  });
});

describe("token storage", () => {
  test("round-trips through localStorage", () => {
    setApiToken("s3cret");
    expect(getApiToken()).toBe("s3cret");
  });

  test("clearing removes the key rather than storing an empty string", () => {
    setApiToken("s3cret");
    setApiToken("");
    expect(getApiToken()).toBe("");
    expect(window.localStorage.getItem("epichem.apiToken")).toBeNull();
  });
});

describe("request headers", () => {
  test("sends no Authorization header when no token is stored", async () => {
    const fetchMock = mockFetch({ json: async () => [] });

    await apiGet("/samples");

    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  test("sends a bearer token when one is stored", async () => {
    setApiToken("s3cret");
    const fetchMock = mockFetch({ json: async () => [] });

    await apiGet("/samples");

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer s3cret");
  });

  test("sets Content-Type only when there is a body", async () => {
    const fetchMock = mockFetch({ status: 201, json: async () => ({}) });

    await apiPost("/samples", { code: "S1" });

    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
    expect(fetchMock.mock.calls[0][1].body).toBe('{"code":"S1"}');
  });
});

describe("error handling", () => {
  test("surfaces a problem+json title and detail", async () => {
    mockFetch({
      ok: false,
      status: 409,
      json: async () => ({
        title: "Sample already exists",
        status: 409,
        detail: "Sample with code='S1' already exists",
      }),
    });

    const error = await expectApiError(apiPost("/samples", {}));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("Sample already exists: Sample with code='S1' already exists");
  });

  test("falls back to the status line when the body isn't JSON", async () => {
    mockFetch({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new SyntaxError("not json");
      },
    });

    const error = await expectApiError(apiGet("/samples"));

    expect(error.status).toBe(502);
    expect(error.message).toBe("502 Bad Gateway");
  });

  test("stringifies FastAPI's array-shaped validation detail", async () => {
    mockFetch({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ loc: ["body", "code"], msg: "field required" }] }),
    });

    const error = await expectApiError(apiGet("/samples"));

    expect(error.detail).toContain("field required");
  });

  test("a network failure says the backend is unreachable, not 'failed to fetch'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await expectApiError(apiGet("/samples"));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toContain("Cannot reach the EPIChem API");
    expect(error.message).toContain("8000");
  });
});

describe("apiGetPage", () => {
  test("reads the total from X-Total-Count", async () => {
    mockFetch({
      headers: new Headers({ "X-Total-Count": "342" }),
      json: async () => [{ id: "1" }],
    });

    expect(await apiGetPage("/samples")).toEqual({ items: [{ id: "1" }], total: 342 });
  });

  test("falls back to the page length when the header is missing", async () => {
    // A proxy that strips the header should degrade to "no pager", not to a
    // total of NaN.
    mockFetch({ headers: new Headers(), json: async () => [{ id: "1" }, { id: "2" }] });

    expect((await apiGetPage("/samples")).total).toBe(2);
  });

  test("raises the same ApiError as everything else on failure", async () => {
    mockFetch({ ok: false, status: 401, json: async () => ({ title: "Not authenticated" }) });

    const error = await expectApiError(apiGetPage("/samples"));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
  });
});

describe("apiDelete", () => {
  test("returns undefined for a 204 rather than trying to parse a body", async () => {
    mockFetch({ status: 204, json: async () => Promise.reject(new Error("no body")) });

    await expect(apiDelete("/samples/S1")).resolves.toBeUndefined();
  });
});
