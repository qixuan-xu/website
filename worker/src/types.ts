export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  ADMIN_ORIGIN: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAIL?: string;
  DEV_BEARER_TOKEN?: string;
}

export interface Identity {
  sub: string;
  email: string;
  name: string;
  expiresAt: number | null;
  assertion: string;
}

export type VersionAction = "draft" | "publish" | "rollback";

export interface ContentVersion {
  id: string;
  revision: number;
  content: JsonObject;
  action: VersionAction;
  sourceVersionId: string | null;
  createdAt: string;
  createdBy: string;
}

export interface ContentState {
  content: JsonObject;
  revision: number;
  versionId: string;
  updatedAt: string;
  updatedBy: string;
  publishedRevision: string | null;
}

export interface VersionSummary {
  id: string;
  revision: number;
  action: VersionAction;
  sourceVersionId: string | null;
  createdAt: string;
  createdBy: string;
  isPublished: boolean;
}

export interface Repository {
  getDraft(): Promise<ContentState>;
  getPublished(): Promise<ContentState>;
  saveDraft(input: {
    content: JsonObject;
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState>;
  publish(input: {
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState>;
  listVersions(input: {
    limit: number;
    beforeRevision: number | null;
  }): Promise<{ items: VersionSummary[]; nextCursor: number | null }>;
  rollback(input: {
    versionId: string;
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState>;
}
