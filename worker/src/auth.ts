import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { ApiError } from "./errors";
import type { Env, Identity } from "./types";

const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeTeamDomain(value: string | undefined): string {
  if (!value) {
    throw new ApiError(500, "auth_not_configured", "Access team domain is not configured");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(500, "auth_not_configured", "Access team domain is invalid");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com")) {
    throw new ApiError(500, "auth_not_configured", "Access team domain must be a Cloudflare Access HTTPS domain");
  }
  return url.origin;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

async function authenticateDevelopment(request: Request, env: Env): Promise<Identity> {
  if (!env.DEV_BEARER_TOKEN || env.DEV_BEARER_TOKEN.length < 24) {
    throw new ApiError(500, "dev_auth_not_configured", "Development bearer token must be at least 24 characters");
  }
  const supplied = bearerToken(request);
  if (!supplied || !constantTimeEqual(supplied, env.DEV_BEARER_TOKEN)) {
    throw new ApiError(401, "unauthorized", "A valid local development bearer token is required");
  }
  return {
    sub: "local-development",
    email: "developer@localhost",
    name: "Local developer",
    expiresAt: null,
    assertion: supplied
  };
}

async function authenticateProduction(request: Request, env: Env): Promise<Identity> {
  const domain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  if (!env.ACCESS_AUD) {
    throw new ApiError(500, "auth_not_configured", "Access audience is not configured");
  }
  if (!env.ADMIN_EMAIL) {
    throw new ApiError(500, "auth_not_configured", "Admin email is not configured");
  }

  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) {
    throw new ApiError(401, "unauthorized", "Cloudflare Access authentication is required");
  }

  let jwks = jwksByDomain.get(domain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
    jwksByDomain.set(domain, jwks);
  }

  try {
    const { payload } = await jwtVerify(assertion, jwks, {
      algorithms: ["RS256"],
      audience: env.ACCESS_AUD,
      issuer: domain
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (!email || email !== env.ADMIN_EMAIL.trim().toLowerCase()) {
      throw new ApiError(403, "forbidden", "This identity is not an administrator");
    }
    if (!payload.sub) {
      throw new ApiError(401, "invalid_access_token", "Access token has no subject");
    }
    const name = typeof payload.name === "string" && payload.name.trim() ? payload.name : email;
    return {
      sub: payload.sub,
      email,
      name,
      expiresAt: typeof payload.exp === "number" ? payload.exp : null,
      assertion
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof joseErrors.JOSEError) {
      throw new ApiError(401, "invalid_access_token", "Cloudflare Access token is invalid or expired");
    }
    throw new ApiError(503, "auth_unavailable", "Cloudflare Access verification is temporarily unavailable");
  }
}

export async function authenticate(request: Request, env: Env): Promise<Identity> {
  if (env.ENVIRONMENT === "development") {
    return authenticateDevelopment(request, env);
  }
  if (env.ENVIRONMENT !== "production") {
    throw new ApiError(500, "invalid_environment", "ENVIRONMENT must be production or development");
  }
  return authenticateProduction(request, env);
}

export function accessLogoutUrl(env: Env): string {
  return `${normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN)}/cdn-cgi/access/logout`;
}

export async function csrfTokenFor(identity: Identity): Promise<string> {
  const input = new TextEncoder().encode(`qixuan-admin-csrf-v1\0${identity.assertion}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function requireCsrf(request: Request, env: Env, identity: Identity): Promise<void> {
  const configuredOrigin = env.ADMIN_ORIGIN?.replace(/\/$/, "");
  if (!configuredOrigin) {
    throw new ApiError(500, "origin_not_configured", "Admin origin is not configured");
  }
  const origin = request.headers.get("origin");
  if (origin !== configuredOrigin) {
    throw new ApiError(403, "invalid_origin", "Request origin is not allowed");
  }
  const supplied = request.headers.get("x-csrf-token");
  const expected = await csrfTokenFor(identity);
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    throw new ApiError(403, "invalid_csrf_token", "CSRF token is missing or invalid");
  }
}
