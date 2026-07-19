import defaultSiteContent from "../../content/site.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { ApiError } from "../src/errors";
import type {
  ContentState,
  Env,
  JsonObject,
  Repository,
  VersionAction,
  VersionSummary
} from "../src/types";

const DEV_TOKEN = "local-test-token-that-is-long-enough";
const ORIGIN = "http://localhost:8787";

interface StoredVersion extends VersionSummary {
  content: JsonObject;
}

interface TestApp {
  fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response>;
}

class MemoryRepository implements Repository {
  private revision = 0;
  private draftContent = structuredClone(defaultSiteContent) as JsonObject;
  private draftId = "version-0";
  private publishedId = "version-0";
  private readonly versions: StoredVersion[] = [{
    id: "version-0",
    revision: 0,
    content: structuredClone(defaultSiteContent) as JsonObject,
    action: "publish",
    sourceVersionId: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    createdBy: "system",
    isPublished: true
  }];

  private state(content = this.draftContent): ContentState {
    const version = this.versions.find((item) => item.id === this.draftId) ?? this.versions[0]!;
    return {
      content: structuredClone(content),
      revision: this.revision,
      versionId: this.draftId,
      updatedAt: version.createdAt,
      updatedBy: version.createdBy,
      publishedRevision: this.publishedId
    };
  }

  async getDraft(): Promise<ContentState> {
    return this.state();
  }

  async getPublished(): Promise<ContentState> {
    const version = this.versions.find((item) => item.id === this.publishedId)!;
    return {
      content: structuredClone(version.content),
      revision: version.revision,
      versionId: version.id,
      updatedAt: version.createdAt,
      updatedBy: version.createdBy,
      publishedRevision: version.id
    };
  }

  async saveDraft(input: {
    content: JsonObject;
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState> {
    this.checkRevision(input.expectedRevision);
    this.addVersion("draft", input.content, input.actor, this.draftId);
    return this.getDraft();
  }

  async publish(input: {
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState> {
    this.checkRevision(input.expectedRevision);
    this.addVersion("publish", this.draftContent, input.actor, this.draftId);
    this.publishedId = this.draftId;
    this.versions.forEach((version) => { version.isPublished = version.id === this.publishedId; });
    return this.getDraft();
  }

  async listVersions(input: {
    limit: number;
    beforeRevision: number | null;
  }): Promise<{ items: VersionSummary[]; nextCursor: number | null }> {
    const eligible = this.versions
      .filter((item) => input.beforeRevision === null || item.revision < input.beforeRevision)
      .sort((left, right) => right.revision - left.revision);
    const visible = eligible.slice(0, input.limit);
    return {
      items: visible.map(({ content: _content, ...summary }) => summary),
      nextCursor: eligible.length > input.limit ? visible.at(-1)?.revision ?? null : null
    };
  }

  async rollback(input: {
    versionId: string;
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState> {
    this.checkRevision(input.expectedRevision);
    const target = this.versions.find((item) => item.id === input.versionId);
    if (!target) throw new ApiError(404, "version_not_found", "Requested content version was not found");
    this.addVersion("rollback", target.content, input.actor, target.id);
    return this.getDraft();
  }

  private checkRevision(expected: number): void {
    if (expected !== this.revision) {
      throw new ApiError(409, "revision_conflict", "Content changed since it was loaded", {
        actualRevision: this.revision
      });
    }
  }

  private addVersion(
    action: VersionAction,
    content: JsonObject,
    actor: string,
    sourceVersionId: string,
  ): void {
    this.revision += 1;
    this.draftId = `version-${this.revision}`;
    this.draftContent = structuredClone(content);
    this.versions.push({
      id: this.draftId,
      revision: this.revision,
      content: structuredClone(content),
      action,
      sourceVersionId,
      createdAt: new Date(this.revision * 1_000).toISOString(),
      createdBy: actor,
      isPublished: false
    });
  }
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    MEDIA: {} as KVNamespace,
    ANALYTICS_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true }))
    } as unknown as RateLimit,
    ASSETS: {
      fetch: vi.fn(async () => new Response("admin asset", {
        headers: { "Content-Type": "text/html" }
      }))
    } as unknown as Fetcher,
    ENVIRONMENT: "development",
    ADMIN_ORIGIN: ORIGIN,
    MEDIA_PUBLIC_ORIGIN: "https://api.qixuan.net",
    DEV_BEARER_TOKEN: DEV_TOKEN,
    ...overrides
  };
}

function authHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${DEV_TOKEN}`);
  return headers;
}

async function sessionCsrf(app: TestApp, env: Env): Promise<string> {
  const response = await app.fetch(
    new Request(`${ORIGIN}/v1/admin/session`, { headers: authHeaders() }),
    env,
    {} as ExecutionContext,
  );
  const body = await response.json() as { data: { csrfToken: string } };
  return body.data.csrfToken;
}

function mutationHeaders(csrf: string, extra: HeadersInit = {}): Headers {
  return authHeaders({
    "Content-Type": "application/json",
    Origin: ORIGIN,
    "X-CSRF-Token": csrf,
    ...Object.fromEntries(new Headers(extra))
  });
}

describe("qixuan admin worker", () => {
  let repository: MemoryRepository;
  let env: Env;
  let app: TestApp;

  beforeEach(() => {
    repository = new MemoryRepository();
    env = makeEnv();
    app = createApp({ repository }) as unknown as TestApp;
  });

  it("serves public content with the site content directly under data", async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/content`),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { data: JsonObject; meta: { revision: number } };

    expect(response.status).toBe(200);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.meta.revision).toBe(0);
    expect(response.headers.get("etag")).toBe('"published-version-0"');
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("supports conditional GET for published content", async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/content`, {
        headers: { "If-None-Match": '"published-version-0"' }
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("handles public content CORS preflight without enabling admin CORS", async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/content`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://qixuan.net",
          "Access-Control-Request-Method": "GET"
        }
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("serves a public health endpoint without authentication", async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/health`),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { data: { status: string } };
    expect(body.data.status).toBe("ok");
  });

  it("uses the ASSETS binding for non-API requests", async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/`),
      env,
      {} as ExecutionContext,
    );
    expect(await response.text()).toBe("admin asset");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("does not expose admin assets from a non-admin hostname", async () => {
    const response = await app.fetch(
      new Request("https://api.qixuan.net/"),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("requires the development bearer token for admin routes", async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/session`),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  it("does not permit the development bearer bypass in production", async () => {
    env = makeEnv({
      ENVIRONMENT: "production",
      ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
      ACCESS_AUD: "audience",
      ADMIN_EMAIL: "admin@example.com"
    });
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/session`, { headers: authHeaders() }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  it("fails closed when production Access secrets are missing", async () => {
    env = makeEnv({
      ENVIRONMENT: "production"
    });
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/session`, { headers: authHeaders() }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("auth_not_configured");
  });

  it("returns session identity, CSRF token, and no-store caching", async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/session`, { headers: authHeaders() }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      data: { authenticated: boolean; email: string; csrfToken: string; logoutUrl: null };
    };
    expect(body.data.authenticated).toBe(true);
    expect(body.data.email).toBe("developer@localhost");
    expect(body.data.csrfToken.length).toBeGreaterThan(30);
    expect(body.data.logoutUrl).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects mutations with an invalid origin or missing CSRF token", async () => {
    const csrf = await sessionCsrf(app, env);
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/publish`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", Origin: "https://evil.example" }),
        body: JSON.stringify({ expectedRevision: 0, csrf })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("invalid_origin");
  });

  it("saves a schema-valid draft using If-Match and returns the next ETag", async () => {
    const csrf = await sessionCsrf(app, env);
    const content = structuredClone(defaultSiteContent);
    content.site.footerText = "Updated safely";
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/content`, {
        method: "PUT",
        headers: mutationHeaders(csrf, { "If-Match": '"draft-0"' }),
        body: JSON.stringify({ content })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { data: { revision: number; content: JsonObject } };

    expect(response.status).toBe(200);
    expect(body.data.revision).toBe(1);
    expect(response.headers.get("etag")).toBe('"draft-1"');
  });

  it("rejects content that does not match the site schema", async () => {
    const csrf = await sessionCsrf(app, env);
    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/content`, {
        method: "PUT",
        headers: mutationHeaders(csrf, { "If-Match": '"draft-0"' }),
        body: JSON.stringify({ content: { schemaVersion: 1 } })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string; details: { issues: unknown[] } } };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("schema_validation_failed");
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  it.each(["id", "slug"] as const)("rejects duplicate project %s values", async (field) => {
    const csrf = await sessionCsrf(app, env);
    const content = structuredClone(defaultSiteContent);
    const firstProject = content.projects[0]!;
    const secondProject = content.projects[1]!;
    secondProject[field] = firstProject[field];

    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/content`, {
        method: "PUT",
        headers: mutationHeaders(csrf, { "If-Match": '"draft-0"' }),
        body: JSON.stringify({ content })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      error: { code: string; details: { issues: Array<{ path: string }> } };
    };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("semantic_validation_failed");
    expect(body.error.details.issues).toContainEqual(
      expect.objectContaining({ path: `/projects/1/${field}` }),
    );
  });

  it("rejects HTTPS content URLs that contain userinfo credentials", async () => {
    const csrf = await sessionCsrf(app, env);
    const content = structuredClone(defaultSiteContent);
    const projectWithLink = content.projects.find((project) => project.link !== null)!;
    projectWithLink.link!.url = "https://username:password@example.com/project";

    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/content`, {
        method: "PUT",
        headers: mutationHeaders(csrf, { "If-Match": '"draft-0"' }),
        body: JSON.stringify({ content })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      error: { code: string; details: { issues: Array<{ path: string; message: string }> } };
    };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("semantic_validation_failed");
    expect(body.error.details.issues).toContainEqual(expect.objectContaining({
      message: expect.stringContaining("username or password") as string
    }));
  });

  it("accepts a project image served by the controlled media route", async () => {
    const csrf = await sessionCsrf(app, env);
    const content = structuredClone(defaultSiteContent);
    (content.projects[0] as unknown as { visual: unknown }).visual = {
      type: "image",
      url: "https://api.qixuan.net/v1/media/0123456789abcdef0123456789abcdef.webp",
      alt: "Camera detections over a road scene"
    };

    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/content`, {
        method: "PUT",
        headers: mutationHeaders(csrf, { "If-Match": '"draft-0"' }),
        body: JSON.stringify({ content })
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
  });

  it.each([
    "https://images.example/0123456789abcdef0123456789abcdef.webp",
    "https://api.qixuan.net/v1/media/0123456789abcdef0123456789abcdef.webp?download=1",
    "https://api.qixuan.net/v1/media/not-a-controlled-key.webp"
  ])("rejects an uncontrolled project image URL: %s", async (url) => {
    const csrf = await sessionCsrf(app, env);
    const content = structuredClone(defaultSiteContent);
    (content.projects[0] as unknown as { visual: unknown }).visual = {
      type: "image",
      url,
      alt: "Project cover"
    };

    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/content`, {
        method: "PUT",
        headers: mutationHeaders(csrf, { "If-Match": '"draft-0"' }),
        body: JSON.stringify({ content })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      error: { code: string; details: { issues: Array<{ path: string }> } };
    };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("semantic_validation_failed");
    expect(body.error.details.issues).toContainEqual(
      expect.objectContaining({ path: "/projects/0/visual/url" }),
    );
  });

  it("rejects email domains without a dot to match the public client contract", async () => {
    const csrf = await sessionCsrf(app, env);
    const content = structuredClone(defaultSiteContent);
    content.site.email = "qixuan@localhost";

    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/content`, {
        method: "PUT",
        headers: mutationHeaders(csrf, { "If-Match": '"draft-0"' }),
        body: JSON.stringify({ content })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      error: { code: string; details: { issues: Array<{ path: string }> } };
    };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("semantic_validation_failed");
    expect(body.error.details.issues).toContainEqual(
      expect.objectContaining({ path: "/site/email" }),
    );
  });

  it("publishes, lists versions, and restores a selected version as a draft", async () => {
    const csrf = await sessionCsrf(app, env);
    const publishResponse = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/publish`, {
        method: "POST",
        headers: mutationHeaders(csrf),
        body: JSON.stringify({ expectedRevision: 0 })
      }),
      env,
      {} as ExecutionContext,
    );
    expect(publishResponse.status).toBe(200);

    const versionsResponse = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/versions`, { headers: authHeaders() }),
      env,
      {} as ExecutionContext,
    );
    const versions = await versionsResponse.json() as {
      data: { items: Array<{ id: string; action: string }> };
    };
    expect(versions.data.items[0]?.action).toBe("publish");

    const rollbackResponse = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/rollback`, {
        method: "POST",
        headers: mutationHeaders(csrf),
        body: JSON.stringify({ versionId: "version-0", expectedRevision: 1 })
      }),
      env,
      {} as ExecutionContext,
    );
    const rollback = await rollbackResponse.json() as { data: { revision: number } };
    expect(rollbackResponse.status).toBe(200);
    expect(rollback.data.revision).toBe(2);
  });
});
