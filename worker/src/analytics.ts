import { ApiError } from "./errors";
import type { Env, Repository } from "./types";

const MAX_EVENT_BYTES = 2 * 1024;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

type AnalyticsEventType = "page_view" | "project_click";

interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  path: string;
  projectId: string;
  referrerHost: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function referrerCategory(host: string): string {
  const normalized = host.toLowerCase();
  if (!normalized) return "Direct";
  if (normalized === "github.com" || normalized.endsWith(".github.com")) return "GitHub";
  if (/(^|\.)google\.[a-z.]+$/.test(normalized)) return "Google";
  return "Other";
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (env.ENVIRONMENT === "production") return origin === "https://qixuan.net" ? origin : null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return null;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" ? origin : null;
  } catch {
    return null;
  }
}

export function analyticsCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const origin = allowedOrigin(request, env);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

export function analyticsOptions(request: Request, env: Env): Response {
  const origin = allowedOrigin(request, env);
  if (!origin) throw new ApiError(403, "invalid_origin", "Analytics origin is not allowed");
  const headers = analyticsCorsHeaders(request, env);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(null, { status: 204, headers });
}

async function readEvent(request: Request): Promise<AnalyticsEvent> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_EVENT_BYTES) {
    throw new ApiError(413, "analytics_event_too_large", "Analytics event is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_EVENT_BYTES) {
    throw new ApiError(413, "analytics_event_too_large", "Analytics event is too large");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Analytics event is not valid JSON");
  }
  if (!isRecord(body)) throw new ApiError(400, "invalid_analytics_event", "Analytics event must be an object");

  const eventType = body.eventType;
  const path = body.path;
  const projectId = body.projectId ?? "";
  const referrerHost = body.referrerHost ?? "";
  if (eventType !== "page_view" && eventType !== "project_click") {
    throw new ApiError(422, "invalid_analytics_event", "eventType is invalid");
  }
  if (path !== "/") {
    throw new ApiError(422, "invalid_analytics_event", "path must identify the public homepage");
  }
  if (typeof projectId !== "string" || (eventType === "project_click" ? !PROJECT_ID_PATTERN.test(projectId) : projectId !== "")) {
    throw new ApiError(422, "invalid_analytics_event", "projectId is invalid");
  }
  if (typeof referrerHost !== "string" || (referrerHost !== "" && !HOST_PATTERN.test(referrerHost))) {
    throw new ApiError(422, "invalid_analytics_event", "referrerHost is invalid");
  }
  if (eventType === "project_click" && referrerHost !== "") {
    throw new ApiError(422, "invalid_analytics_event", "project clicks must not include a referrer");
  }
  return {
    eventType,
    path,
    projectId,
    referrerHost: eventType === "page_view" ? referrerCategory(referrerHost) : ""
  };
}

function requireCollectorRequest(request: Request, env: Env): void {
  if (!allowedOrigin(request, env)) throw new ApiError(403, "invalid_origin", "Analytics origin is not allowed");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-site" && fetchSite !== "same-origin") {
    throw new ApiError(403, "invalid_fetch_context", "Analytics fetch context is not allowed");
  }
}

async function enforceAnalyticsRateLimit(request: Request, env: Env): Promise<void> {
  if (!env.ANALYTICS_RATE_LIMITER) {
    throw new ApiError(500, "analytics_rate_limit_unavailable", "Analytics rate limiting is not configured");
  }
  const key = request.headers.get("cf-connecting-ip") || "local-or-unknown";
  const outcome = await env.ANALYTICS_RATE_LIMITER.limit({ key });
  if (!outcome.success) {
    throw new ApiError(429, "analytics_rate_limited", "Too many analytics events were submitted");
  }
}

async function requirePublishedProject(projectId: string, repository: Repository): Promise<void> {
  const published = await repository.getPublished();
  const projects = published.content.projects;
  const exists = Array.isArray(projects) && projects.some((project) => {
    return isRecord(project) && project.id === projectId && project.published === true;
  });
  if (!exists) {
    throw new ApiError(422, "invalid_analytics_event", "projectId must identify a published project");
  }
}

export async function collectAnalytics(
  request: Request,
  env: Env,
  repository: Repository,
): Promise<Record<string, unknown>> {
  requireCollectorRequest(request, env);
  await enforceAnalyticsRateLimit(request, env);
  const event = await readEvent(request);
  if (event.eventType === "project_click") {
    await requirePublishedProject(event.projectId, repository);
  }
  await env.DB.prepare(
    `INSERT INTO analytics_daily (
      day, path, referrer_host, event_type, project_id, event_count
    ) VALUES (date('now'), ?, ?, ?, ?, 1)
    ON CONFLICT(day, path, referrer_host, event_type, project_id)
    DO UPDATE SET event_count = event_count + 1`,
  ).bind(event.path, event.referrerHost, event.eventType, event.projectId).run();
  return { accepted: true };
}

export async function pruneAnalytics(env: Env): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM analytics_daily WHERE day < date('now', '-179 day')",
  ).run();
}

export function parseAnalyticsDays(value: string | null): number {
  if (value === null || value === "") return 30;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || ![7, 30, 90, 180].includes(days)) {
    throw new ApiError(400, "invalid_analytics_range", "days must be 7, 30, 90, or 180");
  }
  return days;
}

interface CountRow {
  event_type: AnalyticsEventType;
  total: number;
}

interface DailyRow {
  day: string;
  event_type: AnalyticsEventType;
  total: number;
}

interface RankedRow {
  label: string;
  total: number;
}

export async function analyticsSummary(env: Env, days: number): Promise<Record<string, unknown>> {
  const sinceModifier = `-${days - 1} day`;
  const [totalsResult, dailyResult, projectsResult, referrersResult] = await env.DB.batch([
    env.DB.prepare(
      "SELECT event_type, SUM(event_count) AS total FROM analytics_daily WHERE day >= date('now', ?) GROUP BY event_type",
    ).bind(sinceModifier),
    env.DB.prepare(
      "SELECT day, event_type, SUM(event_count) AS total FROM analytics_daily WHERE day >= date('now', ?) GROUP BY day, event_type ORDER BY day ASC",
    ).bind(sinceModifier),
    env.DB.prepare(
      "SELECT project_id AS label, SUM(event_count) AS total FROM analytics_daily WHERE day >= date('now', ?) AND event_type = 'project_click' GROUP BY project_id ORDER BY total DESC, project_id ASC LIMIT 8",
    ).bind(sinceModifier),
    env.DB.prepare(
      "SELECT CASE WHEN referrer_host = '' THEN 'Direct' ELSE referrer_host END AS label, SUM(event_count) AS total FROM analytics_daily WHERE day >= date('now', ?) AND event_type = 'page_view' GROUP BY referrer_host ORDER BY total DESC, referrer_host ASC LIMIT 8",
    ).bind(sinceModifier)
  ]);

  const totals = { pageViews: 0, projectClicks: 0 };
  for (const row of (totalsResult?.results ?? []) as unknown as CountRow[]) {
    if (row.event_type === "page_view") totals.pageViews = Number(row.total) || 0;
    if (row.event_type === "project_click") totals.projectClicks = Number(row.total) || 0;
  }
  const dailyByDay = new Map<string, { day: string; pageViews: number; projectClicks: number }>();
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(todayUtc - offset * 86_400_000).toISOString().slice(0, 10);
    dailyByDay.set(day, { day, pageViews: 0, projectClicks: 0 });
  }
  for (const row of (dailyResult?.results ?? []) as unknown as DailyRow[]) {
    const item = dailyByDay.get(row.day) ?? { day: row.day, pageViews: 0, projectClicks: 0 };
    if (row.event_type === "page_view") item.pageViews = Number(row.total) || 0;
    if (row.event_type === "project_click") item.projectClicks = Number(row.total) || 0;
    dailyByDay.set(row.day, item);
  }
  const ranked = (rows: unknown[]): Array<{ label: string; count: number }> => rows.map((row) => {
    const item = row as RankedRow;
    return { label: item.label, count: Number(item.total) || 0 };
  });
  return {
    range: { days },
    totals,
    daily: Array.from(dailyByDay.values()),
    topProjects: ranked(projectsResult?.results ?? []),
    topReferrers: ranked(referrersResult?.results ?? [])
  };
}
