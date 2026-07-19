import defaultSiteContent from "../../content/site.json";
import { ApiError, isUniqueConstraintError } from "./errors";
import { validateContent } from "./model";
import type {
  ContentState,
  ContentVersion,
  Env,
  JsonObject,
  Repository,
  VersionAction,
  VersionSummary
} from "./types";

const INITIAL_VERSION_ID = "initial-site-content-v1";
const DEFAULT_CONTENT = validateContent(defaultSiteContent);

interface StateRow {
  id: string;
  revision: number;
  content_json: string;
  action: VersionAction;
  source_version_id: string | null;
  created_at: string;
  created_by: string;
  published_revision: string | null;
}

interface VersionRow {
  id: string;
  revision: number;
  content_json: string;
  action: VersionAction;
  source_version_id: string | null;
  created_at: string;
  created_by: string;
  is_published: number;
}

type VersionSummaryRow = Omit<VersionRow, "content_json">;

function parseStoredContent(raw: string): JsonObject {
  try {
    return validateContent(JSON.parse(raw));
  } catch {
    throw new ApiError(500, "stored_content_invalid", "Stored content failed schema validation");
  }
}

function stateFromRow(row: StateRow): ContentState {
  return {
    content: parseStoredContent(row.content_json),
    revision: row.revision,
    versionId: row.id,
    updatedAt: row.created_at,
    updatedBy: row.created_by,
    publishedRevision: row.published_revision
  };
}

function versionFromRow(row: VersionRow): ContentVersion {
  return {
    id: row.id,
    revision: row.revision,
    content: parseStoredContent(row.content_json),
    action: row.action,
    sourceVersionId: row.source_version_id,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

function versionSummaryFromRow(row: VersionSummaryRow): VersionSummary {
  return {
    id: row.id,
    revision: row.revision,
    action: row.action,
    sourceVersionId: row.source_version_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    isPublished: row.is_published === 1
  };
}

function assertChanged(result: D1Result<unknown>, actualRevision: number): void {
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, "revision_conflict", "Content changed since it was loaded", {
      actualRevision
    });
  }
}

export class D1ContentRepository implements Repository {
  constructor(private readonly db: Env["DB"]) {}

  private async ensureSeed(): Promise<void> {
    const existing = await this.db
      .prepare("SELECT singleton_id FROM content_state WHERE singleton_id = 1")
      .first<{ singleton_id: number }>();
    if (existing) return;

    const now = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO content_versions
           (id, revision, content_json, action, source_version_id, created_at, created_by)
           VALUES (?, 0, ?, 'publish', NULL, ?, 'system')`,
        )
        .bind(INITIAL_VERSION_ID, JSON.stringify(DEFAULT_CONTENT), now),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO content_state
           (singleton_id, draft_version_id, draft_revision, published_version_id, updated_at, updated_by)
           VALUES (1, ?, 0, ?, ?, 'system')`,
        )
        .bind(INITIAL_VERSION_ID, INITIAL_VERSION_ID, now)
    ]);
  }

  async getDraft(): Promise<ContentState> {
    await this.ensureSeed();
    const row = await this.db
      .prepare(
        `SELECT v.id, v.revision, v.content_json, v.action, v.source_version_id,
                v.created_at, v.created_by, s.published_version_id AS published_revision
         FROM content_state s
         JOIN content_versions v ON v.id = s.draft_version_id
         WHERE s.singleton_id = 1`,
      )
      .first<StateRow>();
    if (!row) throw new ApiError(500, "content_state_missing", "Content state is unavailable");
    return stateFromRow(row);
  }

  async getPublished(): Promise<ContentState> {
    await this.ensureSeed();
    const row = await this.db
      .prepare(
        `SELECT v.id, v.revision, v.content_json, v.action, v.source_version_id,
                v.created_at, v.created_by, s.published_version_id AS published_revision
         FROM content_state s
         JOIN content_versions v ON v.id = s.published_version_id
         WHERE s.singleton_id = 1`,
      )
      .first<StateRow>();
    if (!row) throw new ApiError(500, "content_state_missing", "Published content is unavailable");
    return stateFromRow(row);
  }

  async saveDraft(input: {
    content: JsonObject;
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState> {
    const current = await this.getDraft();
    if (current.revision !== input.expectedRevision) {
      throw new ApiError(409, "revision_conflict", "Content changed since it was loaded", {
        actualRevision: current.revision
      });
    }
    const nextRevision = current.revision + 1;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO content_versions
             (id, revision, content_json, action, source_version_id, created_at, created_by)
             VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
          )
          .bind(id, nextRevision, JSON.stringify(input.content), current.versionId, now, input.actor),
        this.db
          .prepare(
            `UPDATE content_state
             SET draft_version_id = ?, draft_revision = ?, updated_at = ?, updated_by = ?
             WHERE singleton_id = 1 AND draft_revision = ?`,
          )
          .bind(id, nextRevision, now, input.actor, input.expectedRevision),
        this.auditStatement("content.draft", input.actor, id, input.requestId, now, {
          revision: nextRevision,
          basedOn: current.versionId
        })
      ]);
      const updateResult = results[1];
      if (!updateResult) throw new ApiError(500, "database_error", "Draft update did not complete");
      assertChanged(updateResult, (await this.getDraft()).revision);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isUniqueConstraintError(error)) {
        throw new ApiError(409, "revision_conflict", "Content changed since it was loaded");
      }
      throw error;
    }
    return this.getDraft();
  }

  async publish(input: {
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState> {
    const current = await this.getDraft();
    if (current.revision !== input.expectedRevision) {
      throw new ApiError(409, "revision_conflict", "Content changed since it was loaded", {
        actualRevision: current.revision
      });
    }
    const nextRevision = current.revision + 1;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO content_versions
             (id, revision, content_json, action, source_version_id, created_at, created_by)
             VALUES (?, ?, ?, 'publish', ?, ?, ?)`,
          )
          .bind(id, nextRevision, JSON.stringify(current.content), current.versionId, now, input.actor),
        this.db
          .prepare(
            `UPDATE content_state
             SET draft_version_id = ?, draft_revision = ?, published_version_id = ?,
                 updated_at = ?, updated_by = ?
             WHERE singleton_id = 1 AND draft_revision = ?`,
          )
          .bind(id, nextRevision, id, now, input.actor, input.expectedRevision),
        this.auditStatement("content.publish", input.actor, id, input.requestId, now, {
          revision: nextRevision,
          basedOn: current.versionId
        })
      ]);
      const updateResult = results[1];
      if (!updateResult) throw new ApiError(500, "database_error", "Publish did not complete");
      assertChanged(updateResult, (await this.getDraft()).revision);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isUniqueConstraintError(error)) {
        throw new ApiError(409, "revision_conflict", "Content changed since it was loaded");
      }
      throw error;
    }
    return this.getDraft();
  }

  async listVersions(input: {
    limit: number;
    beforeRevision: number | null;
  }): Promise<{ items: VersionSummary[]; nextCursor: number | null }> {
    await this.ensureSeed();
    const requested = input.limit + 1;
    const statement = input.beforeRevision === null
      ? this.db.prepare(
          `SELECT v.id, v.revision, v.action, v.source_version_id,
                  v.created_at, v.created_by,
                  CASE WHEN v.id = s.published_version_id THEN 1 ELSE 0 END AS is_published
           FROM content_versions v CROSS JOIN content_state s
           WHERE s.singleton_id = 1
           ORDER BY v.revision DESC LIMIT ?`,
        ).bind(requested)
      : this.db.prepare(
          `SELECT v.id, v.revision, v.action, v.source_version_id,
                  v.created_at, v.created_by,
                  CASE WHEN v.id = s.published_version_id THEN 1 ELSE 0 END AS is_published
           FROM content_versions v CROSS JOIN content_state s
           WHERE s.singleton_id = 1 AND v.revision < ?
           ORDER BY v.revision DESC LIMIT ?`,
        ).bind(input.beforeRevision, requested);
    const result = await statement.all<VersionSummaryRow>();
    const hasMore = result.results.length > input.limit;
    const visible = result.results.slice(0, input.limit);
    return {
      items: visible.map(versionSummaryFromRow),
      nextCursor: hasMore ? (visible.at(-1)?.revision ?? null) : null
    };
  }

  async rollback(input: {
    versionId: string;
    expectedRevision: number;
    actor: string;
    requestId: string;
  }): Promise<ContentState> {
    await this.ensureSeed();
    const targetRow = await this.db
      .prepare(
        `SELECT v.id, v.revision, v.content_json, v.action, v.source_version_id,
                v.created_at, v.created_by, 0 AS is_published
         FROM content_versions v WHERE v.id = ?`,
      )
      .bind(input.versionId)
      .first<VersionRow>();
    if (!targetRow) throw new ApiError(404, "version_not_found", "Requested content version was not found");
    const target = versionFromRow(targetRow);
    const current = await this.getDraft();
    if (current.revision !== input.expectedRevision) {
      throw new ApiError(409, "revision_conflict", "Content changed since it was loaded", {
        actualRevision: current.revision
      });
    }

    const nextRevision = current.revision + 1;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO content_versions
             (id, revision, content_json, action, source_version_id, created_at, created_by)
             VALUES (?, ?, ?, 'rollback', ?, ?, ?)`,
          )
          .bind(id, nextRevision, JSON.stringify(target.content), target.id, now, input.actor),
        this.db
          .prepare(
            `UPDATE content_state
             SET draft_version_id = ?, draft_revision = ?, updated_at = ?, updated_by = ?
             WHERE singleton_id = 1 AND draft_revision = ?`,
          )
          .bind(id, nextRevision, now, input.actor, input.expectedRevision),
        this.auditStatement("content.rollback", input.actor, id, input.requestId, now, {
          revision: nextRevision,
          restoredVersion: target.id,
          restoredRevision: target.revision
        })
      ]);
      const updateResult = results[1];
      if (!updateResult) throw new ApiError(500, "database_error", "Rollback did not complete");
      assertChanged(updateResult, (await this.getDraft()).revision);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isUniqueConstraintError(error)) {
        throw new ApiError(409, "revision_conflict", "Content changed since it was loaded");
      }
      throw error;
    }
    return this.getDraft();
  }

  private auditStatement(
    action: string,
    actor: string,
    resource: string,
    requestId: string,
    createdAt: string,
    details: Record<string, unknown>,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO audit_log
         (id, action, actor, resource, details_json, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        action,
        actor,
        resource,
        JSON.stringify(details),
        requestId,
        createdAt,
      );
  }
}
