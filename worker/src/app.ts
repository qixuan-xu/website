import { accessLogoutUrl, authenticate, csrfTokenFor, requireCsrf } from "./auth";
import { ApiError } from "./errors";
import {
  parseCursor,
  parseExpectedRevision,
  parseLimit,
  readJsonObject,
  validateContent
} from "./model";
import { D1ContentRepository } from "./repository";
import type { Env, Identity, Repository } from "./types";

type Authenticator = (request: Request, env: Env) => Promise<Identity>;

interface AppDependencies {
  repository?: Repository;
  authenticate?: Authenticator;
}

interface RequestContext {
  request: Request;
  env: Env;
  repository: Repository;
  requestId: string;
  identity?: Identity;
}

function requestIdFor(request: Request): string {
  return request.headers.get("cf-ray")?.split("-", 1)[0] || crypto.randomUUID();
}

function apiHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has("content-type")) headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function success(data: unknown, requestId: string, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ ok: true, data, requestId }), {
    ...init,
    headers: apiHeaders(init.headers)
  });
}

function errorResponse(error: ApiError, requestId: string): Response {
  const body: {
    ok: false;
    error: { code: string; message: string; requestId: string; details?: unknown };
  } = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      requestId
    }
  };
  if (error.details !== undefined) body.error.details = error.details;
  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: apiHeaders()
  });
}

function publicContentResponse(state: Awaited<ReturnType<Repository["getPublished"]>>, request: Request): Response {
  const etag = `"published-${state.versionId}"`;
  const headers = new Headers({
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ETag: etag
  });
  if (request.headers.get("if-none-match") === etag) {
    headers.delete("Content-Type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(
    JSON.stringify({
      data: state.content,
      meta: {
        revision: state.revision,
        versionId: state.versionId,
        publishedAt: state.updatedAt
      }
    }),
    { headers },
  );
}

function publicContentOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, max-age=86400"
    }
  });
}

function contentPayload(state: Awaited<ReturnType<Repository["getDraft"]>>): Record<string, unknown> {
  return {
    content: state.content,
    revision: state.revision,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
    publishedRevision: state.publishedRevision
  };
}

function isMutation(request: Request): boolean {
  return request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";
}

async function routeAdmin(context: RequestContext, auth: Authenticator): Promise<Response> {
  const { request, env, repository, requestId } = context;
  const url = new URL(request.url);
  const identity = await auth(request, env);
  context.identity = identity;

  if (isMutation(request)) await requireCsrf(request, env, identity);

  if (url.pathname === "/v1/admin/session" && request.method === "GET") {
    const csrfToken = await csrfTokenFor(identity);
    const logoutUrl = env.ENVIRONMENT === "production" ? accessLogoutUrl(env) : null;
    return success({
      authenticated: true,
      user: { sub: identity.sub, email: identity.email, name: identity.name },
      email: identity.email,
      name: identity.name,
      expiresAt: identity.expiresAt,
      csrfToken,
      logoutUrl
    }, requestId);
  }

  if (url.pathname === "/v1/admin/logout" && request.method === "POST") {
    return success({
      logoutUrl: env.ENVIRONMENT === "production" ? accessLogoutUrl(env) : null
    }, requestId);
  }

  if (url.pathname === "/v1/admin/content" && request.method === "GET") {
    const state = await repository.getDraft();
    return success(contentPayload(state), requestId, {
      headers: { ETag: `"draft-${state.revision}"` }
    });
  }

  if (
    (url.pathname === "/v1/admin/content" || url.pathname === "/v1/admin/draft") &&
    request.method === "PUT"
  ) {
    const body = await readJsonObject(request);
    const content = validateContent(body.content);
    const expectedRevision = parseExpectedRevision(request, body);
    const state = await repository.saveDraft({
      content,
      expectedRevision,
      actor: identity.email,
      requestId
    });
    const response = success(contentPayload(state), requestId, {
      headers: { ETag: `"draft-${state.revision}"` }
    });
    if (url.pathname === "/v1/admin/draft") response.headers.set("Deprecation", "true");
    return response;
  }

  if (url.pathname === "/v1/admin/publish" && request.method === "POST") {
    const body = await readJsonObject(request);
    const expectedRevision = parseExpectedRevision(request, body);
    const state = await repository.publish({
      expectedRevision,
      actor: identity.email,
      requestId
    });
    return success(contentPayload(state), requestId, {
      headers: { ETag: `"draft-${state.revision}"` }
    });
  }

  if (url.pathname === "/v1/admin/versions" && request.method === "GET") {
    const versions = await repository.listVersions({
      limit: parseLimit(url.searchParams.get("limit")),
      beforeRevision: parseCursor(url.searchParams.get("cursor"))
    });
    return success(versions, requestId);
  }

  if (url.pathname === "/v1/admin/rollback" && request.method === "POST") {
    const body = await readJsonObject(request);
    const expectedRevision = parseExpectedRevision(request, body);
    const versionIdValue = body.versionId ?? body.revisionId;
    if (
      typeof versionIdValue !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(versionIdValue)
    ) {
      throw new ApiError(422, "invalid_version_id", "versionId is invalid");
    }
    const state = await repository.rollback({
      versionId: versionIdValue,
      expectedRevision,
      actor: identity.email,
      requestId
    });
    return success(contentPayload(state), requestId, {
      headers: { ETag: `"draft-${state.revision}"` }
    });
  }

  throw new ApiError(404, "not_found", "Admin API route was not found");
}

function applySecurityHeaders(response: Response, env: Env, isApi: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set(
    "Content-Security-Policy",
    isApi
      ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  if (env.ENVIRONMENT === "production") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function staticAssetFallback(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new ApiError(405, "method_not_allowed", "Static assets only support GET and HEAD");
  }
  let adminOrigin: URL;
  try {
    adminOrigin = new URL(env.ADMIN_ORIGIN);
  } catch {
    throw new ApiError(500, "origin_not_configured", "Admin origin is not configured correctly");
  }
  if (new URL(request.url).host !== adminOrigin.host) {
    throw new ApiError(404, "not_found", "Static asset was not found");
  }
  if (!env.ASSETS) throw new ApiError(404, "not_found", "Static asset was not found");
  return env.ASSETS.fetch(request);
}

export function createApp(dependencies: AppDependencies = {}): ExportedHandler<Env> {
  return {
    async fetch(request, env): Promise<Response> {
      const requestId = requestIdFor(request);
      const url = new URL(request.url);
      const isApi = url.pathname === "/v1" || url.pathname.startsWith("/v1/");
      const repository = dependencies.repository ?? new D1ContentRepository(env.DB);
      const auth = dependencies.authenticate ?? authenticate;

      try {
        let response: Response;
        if (url.pathname === "/v1/health" && request.method === "GET") {
          response = success({ status: "ok", service: "qixuan-admin", version: "1" }, requestId);
        } else if (url.pathname === "/v1/content" && request.method === "OPTIONS") {
          response = publicContentOptions();
        } else if (url.pathname === "/v1/content" && (request.method === "GET" || request.method === "HEAD")) {
          response = publicContentResponse(await repository.getPublished(), request);
        } else if (url.pathname.startsWith("/v1/admin/")) {
          response = await routeAdmin({ request, env, repository, requestId }, auth);
        } else if (isApi) {
          throw new ApiError(404, "not_found", "API route was not found");
        } else {
          response = await staticAssetFallback(request, env);
        }
        return applySecurityHeaders(response, env, isApi);
      } catch (error) {
        const apiError = error instanceof ApiError
          ? error
          : new ApiError(500, "internal_error", "An unexpected error occurred");
        if (!(error instanceof ApiError)) {
          console.error("Unhandled worker error", { requestId, path: url.pathname, error });
        }
        return applySecurityHeaders(errorResponse(apiError, requestId), env, true);
      }
    }
  };
}
