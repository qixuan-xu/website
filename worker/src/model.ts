import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import siteSchema from "../../content/site.schema.json";
import { ApiError } from "./errors";
import type { JsonObject, JsonValue } from "./types";

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_DEPTH = 12;
const MAX_KEYS = 1_000;
const MAX_ARRAY_LENGTH = 500;
const MAX_STRING_LENGTH = 50_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_URL_LENGTH = 2_048;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSiteSchema = ajv.compile(siteSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateJsonValue(value: unknown, depth: number, budget: { keys: number }): value is JsonValue {
  if (depth > MAX_DEPTH) {
    throw new ApiError(422, "content_too_deep", `Content exceeds maximum depth of ${MAX_DEPTH}`);
  }

  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new ApiError(422, "string_too_long", "A content string exceeds the allowed length");
    }
    return true;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApiError(422, "invalid_number", "Content numbers must be finite");
    }
    return true;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new ApiError(422, "array_too_large", "A content array has too many entries");
    }
    for (const entry of value) validateJsonValue(entry, depth + 1, budget);
    return true;
  }
  if (!isRecord(value)) {
    throw new ApiError(422, "invalid_content", "Content contains a non-JSON value");
  }

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ApiError(422, "unsafe_key", `Content key '${key}' is not allowed`);
    }
    budget.keys += 1;
    if (budget.keys > MAX_KEYS) {
      throw new ApiError(422, "content_too_large", "Content has too many fields");
    }
    validateJsonValue(entry, depth + 1, budget);
  }
  return true;
}

export function validateContent(value: unknown): JsonObject {
  if (!isRecord(value)) {
    throw new ApiError(422, "invalid_content", "content must be a JSON object");
  }
  validateJsonValue(value, 0, { keys: 0 });
  validateEmailContract(value);
  if (!validateSiteSchema(value)) {
    throw new ApiError(422, "schema_validation_failed", "Content does not match the site schema", {
      issues: (validateSiteSchema.errors ?? []).slice(0, 50).map(formatSchemaError)
    });
  }
  validateContentSemantics(value);
  return value as JsonObject;
}

interface SemanticIssue {
  path: string;
  message: string;
}

function validateContentSemantics(value: Record<string, unknown>): void {
  const issues: SemanticIssue[] = [];
  const projects = value.projects as Array<Record<string, unknown>>;
  addDuplicateProjectIssues(projects, "id", issues);
  addDuplicateProjectIssues(projects, "slug", issues);

  const site = value.site as Record<string, unknown>;
  const now = value.now as Record<string, unknown>;
  const urlFields: Array<{ path: string; value: unknown }> = [
    { path: "/site/canonicalUrl", value: site.canonicalUrl },
    { path: "/site/githubUrl", value: site.githubUrl },
    { path: "/now/url", value: now.url }
  ];
  projects.forEach((project, index) => {
    const link = project.link;
    if (isRecord(link)) {
      urlFields.push({ path: `/projects/${index}/link/url`, value: link.url });
    }
  });
  for (const field of urlFields) addUrlIssues(field.value, field.path, issues);

  if (issues.length > 0) {
    throw new ApiError(422, "semantic_validation_failed", "Content violates site-level constraints", {
      issues: issues.slice(0, 50)
    });
  }
}

function validateEmailContract(value: Record<string, unknown>): void {
  const site = value.site;
  if (!isRecord(site) || typeof site.email !== "string") return;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.email)) return;
  throw new ApiError(422, "semantic_validation_failed", "Content violates site-level constraints", {
    issues: [{
      path: "/site/email",
      message: "must be an email address whose domain contains a dot"
    }]
  });
}

function addDuplicateProjectIssues(
  projects: Array<Record<string, unknown>>,
  key: "id" | "slug",
  issues: SemanticIssue[],
): void {
  const firstIndexByValue = new Map<string, number>();
  projects.forEach((project, index) => {
    const candidate = project[key];
    if (typeof candidate !== "string") return;
    const firstIndex = firstIndexByValue.get(candidate);
    if (firstIndex === undefined) {
      firstIndexByValue.set(candidate, index);
      return;
    }
    issues.push({
      path: `/projects/${index}/${key}`,
      message: `must be unique; '${candidate}' is already used at /projects/${firstIndex}/${key}`
    });
  });
}

function addUrlIssues(value: unknown, path: string, issues: SemanticIssue[]): void {
  if (value === null || value === undefined || typeof value !== "string") return;
  if (value.length > MAX_URL_LENGTH) {
    issues.push({ path, message: `must be at most ${MAX_URL_LENGTH} characters` });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push({ path, message: "must be a valid absolute HTTPS URL" });
    return;
  }
  if (parsed.protocol !== "https:") {
    issues.push({ path, message: "must use HTTPS" });
  }
  if (parsed.username !== "" || parsed.password !== "") {
    issues.push({ path, message: "must not contain username or password credentials" });
  }
}

function formatSchemaError(error: ErrorObject): { path: string; message: string } {
  return {
    path: error.instancePath || "/",
    message: error.message ?? "is invalid"
  };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "request_too_large", "JSON body is too large");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "request_too_large", "JSON body is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new ApiError(400, "invalid_json_object", "Request body must be a JSON object");
  }
  return parsed;
}

export function parseExpectedRevision(
  request: Request,
  body: Record<string, unknown>,
): number {
  const bodyRevision = body.expectedRevision;
  let headerRevision: number | undefined;
  const ifMatch = request.headers.get("if-match");

  if (ifMatch !== null) {
    const match = /^(?:W\/)?"?draft-(\d+)"?$/.exec(ifMatch.trim());
    if (!match?.[1]) {
      throw new ApiError(400, "invalid_if_match", "If-Match must use the draft-N ETag format");
    }
    headerRevision = Number(match[1]);
  }

  if (bodyRevision !== undefined && (!Number.isSafeInteger(bodyRevision) || (bodyRevision as number) < 0)) {
    throw new ApiError(422, "invalid_expected_revision", "expectedRevision must be a non-negative integer");
  }
  if (headerRevision === undefined && bodyRevision === undefined) {
    throw new ApiError(428, "precondition_required", "Send If-Match or expectedRevision");
  }
  if (
    headerRevision !== undefined &&
    bodyRevision !== undefined &&
    headerRevision !== bodyRevision
  ) {
    throw new ApiError(400, "revision_mismatch", "If-Match and expectedRevision do not agree");
  }
  return headerRevision ?? (bodyRevision as number);
}

export function parseLimit(value: string | null): number {
  if (value === null || value === "") return 25;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ApiError(400, "invalid_limit", "limit must be an integer from 1 to 100");
  }
  return parsed;
}

export function parseCursor(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(400, "invalid_cursor", "cursor must be a non-negative revision number");
  }
  return parsed;
}
