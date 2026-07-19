import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { pruneAnalytics } from "../src/analytics";
import type { ContentState, Env, JsonObject, Repository } from "../src/types";

const PUBLIC_ORIGIN = "https://qixuan.net";
const LOCAL_ORIGIN = "http://localhost:8787";
const DEV_TOKEN = "local-test-token-that-is-long-enough";

interface TestApp {
  fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response>;
}

interface PreparedCall {
  query: string;
  values: unknown[];
  run: ReturnType<typeof vi.fn>;
}

interface MockDatabase {
  binding: D1Database;
  prepared: PreparedCall[];
  batch: ReturnType<typeof vi.fn>;
}

interface MockRateLimiter {
  binding: RateLimit;
  limit: ReturnType<typeof vi.fn>;
}

interface MockRepository {
  binding: Repository;
  getPublished: ReturnType<typeof vi.fn>;
}

function result(rows: unknown[]): D1Result<unknown> {
  return {
    success: true,
    results: rows,
    meta: {}
  } as unknown as D1Result<unknown>;
}

function makeDatabase(batchResults: D1Result<unknown>[] = []): MockDatabase {
  const prepared: PreparedCall[] = [];
  const prepare = vi.fn((query: string): D1PreparedStatement => {
    const call: PreparedCall = {
      query,
      values: [],
      run: vi.fn(async () => result([]))
    };
    prepared.push(call);
    const statement = {
      bind: vi.fn((...values: unknown[]) => {
        call.values = values;
        return statement;
      }),
      run: call.run
    };
    return statement as unknown as D1PreparedStatement;
  });
  const batch = vi.fn(async () => batchResults);
  return {
    binding: { prepare, batch } as unknown as D1Database,
    prepared,
    batch
  };
}

function makeRateLimiter(success = true): MockRateLimiter {
  const limit = vi.fn(async () => ({ success }));
  return {
    binding: { limit } as unknown as RateLimit,
    limit
  };
}

function makeRepository(): MockRepository {
  const state: ContentState = {
    content: {
      projects: [
        { id: "flight-controller", published: true },
        { id: "draft-project", published: false }
      ]
    } as JsonObject,
    revision: 1,
    versionId: "published-1",
    updatedAt: "2026-07-19T00:00:00.000Z",
    updatedBy: "system",
    publishedRevision: "published-1"
  };
  const getPublished = vi.fn(async () => structuredClone(state));
  return {
    binding: { getPublished } as unknown as Repository,
    getPublished
  };
}

function makeEnv(
  database: MockDatabase,
  rateLimiter: RateLimit,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: database.binding,
    MEDIA: {} as KVNamespace,
    ANALYTICS_RATE_LIMITER: rateLimiter,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    ENVIRONMENT: "production",
    ADMIN_ORIGIN: LOCAL_ORIGIN,
    MEDIA_PUBLIC_ORIGIN: "https://api.qixuan.net",
    ...overrides
  };
}

function analyticsRequest(
  body: unknown,
  options: {
    contentType?: string;
    fetchSite?: string | null;
    origin?: string | null;
    rawBody?: string;
    connectingIp?: string | null;
  } = {},
): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? PUBLIC_ORIGIN : options.origin;
  const fetchSite = options.fetchSite === undefined ? "same-site" : options.fetchSite;
  if (origin !== null) headers.set("Origin", origin);
  if (fetchSite !== null) headers.set("Sec-Fetch-Site", fetchSite);
  const connectingIp = options.connectingIp === undefined ? "198.51.100.7" : options.connectingIp;
  if (connectingIp !== null) headers.set("CF-Connecting-IP", connectingIp);
  headers.set("Content-Type", options.contentType ?? "application/json; charset=utf-8");
  return new Request("https://api.qixuan.net/v1/analytics", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body)
  });
}

function authHeaders(): Headers {
  return new Headers({ Authorization: `Bearer ${DEV_TOKEN}` });
}

describe("analytics API", () => {
  let database: MockDatabase;
  let env: Env;
  let app: TestApp;
  let rateLimiter: MockRateLimiter;
  let repository: MockRepository;

  beforeEach(() => {
    database = makeDatabase();
    rateLimiter = makeRateLimiter();
    repository = makeRepository();
    env = makeEnv(database, rateLimiter.binding);
    app = createApp({ repository: repository.binding }) as unknown as TestApp;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a published-project click, rate limits by connecting IP, and writes only aggregate dimensions", async () => {
    const response = await app.fetch(
      analyticsRequest({
        eventType: "project_click",
        path: "/",
        projectId: "flight-controller",
        day: "1999-01-01",
        eventCount: 999_999,
        ip: "203.0.113.10",
        userAgent: "do-not-store"
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      ok: boolean;
      data: { accepted: boolean };
      requestId: string;
    };

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ accepted: true });
    expect(body.requestId).toBeTruthy();
    expect(response.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(rateLimiter.limit).toHaveBeenCalledOnce();
    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "198.51.100.7" });
    expect(repository.getPublished).toHaveBeenCalledOnce();

    expect(database.prepared).toHaveLength(1);
    expect(database.prepared[0]?.query).toContain("INSERT INTO analytics_daily");
    expect(database.prepared[0]?.query).toContain("event_count = event_count + 1");
    expect(database.prepared[0]?.query.toLowerCase()).not.toContain("updated_at");
    expect(database.prepared[0]?.values).toEqual([
      "/",
      "",
      "project_click",
      "flight-controller"
    ]);
    expect(database.prepared[0]?.run).toHaveBeenCalledOnce();
    expect(JSON.stringify(database.prepared[0])).not.toContain("198.51.100.7");
    expect(JSON.stringify(database.prepared[0])).not.toContain("203.0.113.10");
    expect(JSON.stringify(database.prepared[0])).not.toContain("do-not-store");
    expect(JSON.stringify(database.prepared[0])).not.toContain("999999");
    expect(JSON.stringify(database.prepared[0])).not.toContain("1999-01-01");
  });

  it.each([
    ["an empty referrer", "", "Direct"],
    ["a GitHub subdomain", "Docs.GitHub.com", "GitHub"],
    ["a regional Google host", "News.Google.co.uk", "Google"],
    ["an arbitrary host", "specific-referrer.example", "Other"],
    ["a non-whitelisted search host", "bing.com", "Other"]
  ])("stores only the privacy category for %s", async (_label, referrerHost, category) => {
    const response = await app.fetch(
      analyticsRequest({ eventType: "page_view", path: "/", referrerHost }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(202);
    expect(database.prepared[0]?.values).toEqual(["/", category, "page_view", ""]);
    if (referrerHost && referrerHost !== category) {
      expect(JSON.stringify(database.prepared[0])).not.toContain(referrerHost);
      expect(JSON.stringify(database.prepared[0])).not.toContain(referrerHost.toLowerCase());
    }
    expect(repository.getPublished).not.toHaveBeenCalled();
  });

  it("returns 429 without reading content or writing D1 when the rate limit is exhausted", async () => {
    rateLimiter = makeRateLimiter(false);
    env.ANALYTICS_RATE_LIMITER = rateLimiter.binding;
    const response = await app.fetch(
      analyticsRequest(
        { eventType: "page_view", path: "/" },
        { connectingIp: "203.0.113.42" },
      ),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("analytics_rate_limited");
    expect(response.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "203.0.113.42" });
    expect(repository.getPublished).not.toHaveBeenCalled();
    expect(database.prepared).toHaveLength(0);
  });

  it.each(["draft-project", "unknown-project"])(
    "rejects a click for the non-published project %s",
    async (projectId) => {
      const response = await app.fetch(
        analyticsRequest({ eventType: "project_click", path: "/", projectId }),
        env,
        {} as ExecutionContext,
      );
      const body = await response.json() as { error: { code: string } };

      expect(response.status).toBe(422);
      expect(body.error.code).toBe("invalid_analytics_event");
      expect(repository.getPublished).toHaveBeenCalledOnce();
      expect(database.prepared).toHaveLength(0);
    },
  );

  it.each([
    ["missing", null],
    ["untrusted production", "https://evil.example"],
    ["HTTP production", "http://qixuan.net"]
  ])("rejects a %s origin without exposing CORS", async (_label, origin) => {
    const response = await app.fetch(
      analyticsRequest({ eventType: "page_view", path: "/" }, { origin }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("invalid_origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
    expect(database.prepared).toHaveLength(0);
  });

  it.each(["cross-site", "none", "navigate"])(
    "rejects the %s fetch context while retaining trusted-origin CORS",
    async (fetchSite) => {
      const response = await app.fetch(
        analyticsRequest({ eventType: "page_view", path: "/" }, { fetchSite }),
        env,
        {} as ExecutionContext,
      );
      const body = await response.json() as { error: { code: string } };

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("invalid_fetch_context");
      expect(response.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
      expect(database.prepared).toHaveLength(0);
    },
  );

  it("accepts development collection only from HTTP localhost origins", async () => {
    env.ENVIRONMENT = "development";
    const allowed = await app.fetch(
      analyticsRequest(
        { eventType: "page_view", path: "/" },
        { origin: "http://127.0.0.1:4321", fetchSite: "same-origin" },
      ),
      env,
      {} as ExecutionContext,
    );
    expect(allowed.status).toBe(202);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4321");

    const rejected = await app.fetch(
      analyticsRequest(
        { eventType: "page_view", path: "/" },
        { origin: "https://localhost:4321", fetchSite: "same-origin" },
      ),
      env,
      {} as ExecutionContext,
    );
    expect(rejected.status).toBe(403);
  });

  it.each([
    ["text/plain", "text/plain"],
    ["missing", null]
  ])("rejects a %s content type", async (_label, contentType) => {
    const request = contentType === null
      ? analyticsRequest({ eventType: "page_view", path: "/" })
      : analyticsRequest({ eventType: "page_view", path: "/" }, { contentType });
    if (contentType === null) request.headers.delete("Content-Type");
    const response = await app.fetch(request, env, {} as ExecutionContext);
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("unsupported_media_type");
    expect(response.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(database.prepared).toHaveLength(0);
  });

  it("rejects malformed JSON, non-object JSON, and oversized bodies", async () => {
    const malformed = await app.fetch(
      analyticsRequest(null, { rawBody: "{" }),
      env,
      {} as ExecutionContext,
    );
    expect(malformed.status).toBe(400);
    expect((await malformed.json() as { error: { code: string } }).error.code).toBe("invalid_json");

    const nonObject = await app.fetch(
      analyticsRequest([], { rawBody: "[]" }),
      env,
      {} as ExecutionContext,
    );
    expect(nonObject.status).toBe(400);
    expect((await nonObject.json() as { error: { code: string } }).error.code).toBe("invalid_analytics_event");

    const oversized = await app.fetch(
      analyticsRequest(null, { rawBody: JSON.stringify({ padding: "x".repeat(2_048) }) }),
      env,
      {} as ExecutionContext,
    );
    expect(oversized.status).toBe(413);
    expect((await oversized.json() as { error: { code: string } }).error.code).toBe("analytics_event_too_large");
    expect(database.prepared).toHaveLength(0);
  });

  it.each([
    ["unknown event", { eventType: "download", path: "/" }],
    ["URL path", { eventType: "page_view", path: "https://qixuan.net/" }],
    ["project path", { eventType: "page_view", path: "/projects" }],
    ["double-slash path", { eventType: "page_view", path: "/projects//secret" }],
    ["page-view project", { eventType: "page_view", path: "/", projectId: "not-empty" }],
    ["missing click project", { eventType: "project_click", path: "/" }],
    ["invalid click project", { eventType: "project_click", path: "/", projectId: "Bad_ID" }],
    ["click referrer", { eventType: "project_click", path: "/", projectId: "flight-controller", referrerHost: "github.com" }],
    ["URL referrer", { eventType: "page_view", path: "/", referrerHost: "https://example.com" }],
    ["non-string referrer", { eventType: "page_view", path: "/", referrerHost: 42 }]
  ])("rejects an invalid event body: %s", async (_label, body) => {
    const response = await app.fetch(
      analyticsRequest(body),
      env,
      {} as ExecutionContext,
    );
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("invalid_analytics_event");
    expect(response.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(database.prepared).toHaveLength(0);
  });

  it("handles trusted and untrusted analytics preflights", async () => {
    const allowed = await app.fetch(
      new Request("https://api.qixuan.net/v1/analytics", {
        method: "OPTIONS",
        headers: {
          Origin: PUBLIC_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type"
        }
      }),
      env,
      {} as ExecutionContext,
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(allowed.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(allowed.headers.get("access-control-max-age")).toBe("86400");
    expect(allowed.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(allowed.headers.get("vary")).toBe("Origin");

    const rejected = await app.fetch(
      new Request("https://api.qixuan.net/v1/analytics", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" }
      }),
      env,
      {} as ExecutionContext,
    );
    expect(rejected.status).toBe(403);
    expect((await rejected.json() as { error: { code: string } }).error.code).toBe("invalid_origin");
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("protects the admin summary and returns the aggregated default 30-day view", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    database = makeDatabase([
      result([
        { event_type: "page_view", total: 12 },
        { event_type: "project_click", total: "5" }
      ]),
      result([
        { day: "2026-07-18", event_type: "page_view", total: 4 },
        { day: "2026-07-18", event_type: "project_click", total: 2 },
        { day: "2026-07-19", event_type: "page_view", total: 8 }
      ]),
      result([
        { label: "flight-controller", total: 3 },
        { label: "game-engine", total: "2" }
      ]),
      result([
        { label: "GitHub", total: 7 },
        { label: "Google", total: "4" }
      ])
    ]);
    env = makeEnv(database, rateLimiter.binding, {
      ENVIRONMENT: "development",
      DEV_BEARER_TOKEN: DEV_TOKEN
    });

    const unauthenticated = await app.fetch(
      new Request(`${LOCAL_ORIGIN}/v1/admin/analytics`),
      env,
      {} as ExecutionContext,
    );
    expect(unauthenticated.status).toBe(401);
    expect(database.batch).not.toHaveBeenCalled();

    const response = await app.fetch(
      new Request(`${LOCAL_ORIGIN}/v1/admin/analytics`, { headers: authHeaders() }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      data: {
        range: { days: number };
        totals: { pageViews: number; projectClicks: number };
        daily: Array<{ day: string; pageViews: number; projectClicks: number }>;
        topProjects: Array<{ label: string; count: number }>;
        topReferrers: Array<{ label: string; count: number }>;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(body.data.range).toEqual({ days: 30 });
    expect(body.data.totals).toEqual({ pageViews: 12, projectClicks: 5 });
    expect(body.data.daily).toHaveLength(30);
    expect(body.data.daily[0]).toEqual({
      day: "2026-06-20",
      pageViews: 0,
      projectClicks: 0
    });
    expect(body.data.daily.at(-2)).toEqual({
      day: "2026-07-18",
      pageViews: 4,
      projectClicks: 2
    });
    expect(body.data.daily.at(-1)).toEqual({
      day: "2026-07-19",
      pageViews: 8,
      projectClicks: 0
    });
    expect(body.data.topProjects).toEqual([
      { label: "flight-controller", count: 3 },
      { label: "game-engine", count: 2 }
    ]);
    expect(body.data.topReferrers).toEqual([
      { label: "GitHub", count: 7 },
      { label: "Google", count: 4 }
    ]);
    expect(database.batch).toHaveBeenCalledOnce();
    expect(database.prepared).toHaveLength(4);
    expect(database.prepared.map((call) => call.values)).toEqual([
      ["-29 day"], ["-29 day"], ["-29 day"], ["-29 day"]
    ]);
  });

  it.each([
    [7, "-6 day"],
    [30, "-29 day"],
    [90, "-89 day"],
    [180, "-179 day"]
  ])("supports the %i-day admin analytics range", async (days, modifier) => {
    database = makeDatabase([result([]), result([]), result([]), result([])]);
    env = makeEnv(database, rateLimiter.binding, {
      ENVIRONMENT: "development",
      DEV_BEARER_TOKEN: DEV_TOKEN
    });
    const response = await app.fetch(
      new Request(`${LOCAL_ORIGIN}/v1/admin/analytics?days=${days}`, { headers: authHeaders() }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { data: { range: { days: number } } };

    expect(response.status).toBe(200);
    expect(body.data.range.days).toBe(days);
    expect(database.prepared).toHaveLength(4);
    expect(database.prepared.every((call) => call.values[0] === modifier)).toBe(true);
  });

  it.each(["0", "8", "30.5", "abc", "181"])(
    "rejects the invalid admin analytics range %s",
    async (days) => {
      env = makeEnv(database, rateLimiter.binding, {
        ENVIRONMENT: "development",
        DEV_BEARER_TOKEN: DEV_TOKEN
      });
      const response = await app.fetch(
        new Request(`${LOCAL_ORIGIN}/v1/admin/analytics?days=${days}`, { headers: authHeaders() }),
        env,
        {} as ExecutionContext,
      );
      const body = await response.json() as { error: { code: string } };

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("invalid_analytics_range");
      expect(database.batch).not.toHaveBeenCalled();
    },
  );

  it("prunes aggregate rows older than the 180-day retention window", async () => {
    await pruneAnalytics(env);

    expect(database.prepared).toHaveLength(1);
    expect(database.prepared[0]?.query).toContain(
      "DELETE FROM analytics_daily WHERE day < date('now', '-179 day')",
    );
    expect(database.prepared[0]?.run).toHaveBeenCalledOnce();
  });
});
