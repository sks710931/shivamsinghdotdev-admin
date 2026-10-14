import "server-only";

import { AuthError } from "@/server/auth-error";
import { query, sql } from "@/server/db";
import { getPostById, type BlogPostDetail, type PostActor } from "@/server/posts";
import { getPendingRevision, type PendingRevision } from "@/server/post-revision";
import { sanitizeHtml } from "@/server/sanitize";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type FieldSpec = { label: string; max: number; required: boolean; column: string; type: () => sql.ISqlTypeFactoryWithLength | sql.ISqlType };

const FIELDS: Record<string, FieldSpec> = {
  title: { label: "Title", max: 200, required: true, column: "Title", type: () => sql.NVarChar(200) },
  slug: { label: "URL slug", max: 180, required: true, column: "Slug", type: () => sql.VarChar(180) },
  summary: { label: "Summary", max: 500, required: false, column: "Summary", type: () => sql.NVarChar(500) },
  tags: { label: "Tags", max: 500, required: false, column: "Tags", type: () => sql.NVarChar(500) },
  seoTitle: { label: "SEO title", max: 200, required: false, column: "SeoTitle", type: () => sql.NVarChar(200) },
  seoKeywords: { label: "SEO keywords", max: 500, required: false, column: "SeoKeywords", type: () => sql.NVarChar(500) },
  bodyHtml: { label: "Body", max: 200_000, required: true, column: "BodyHtml", type: () => sql.NVarChar(sql.MAX) },
};

type EditableField = keyof typeof FIELDS;

export type PostPatch = {
  version: Buffer;
  force: boolean;
  changes: Partial<Record<EditableField, string>>;
};

function invalid(fields: Record<string, string>): never {
  const error = new AuthError("Some fields are invalid.", 400, "validation") as AuthError & {
    fields?: Record<string, string>;
  };
  error.fields = fields;
  throw error;
}

/** Validates a PATCH body against the contract v1.1 allow-list. bodyHtml is sanitised here. */
export function parsePostPatch(input: unknown): PostPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid({ body: "Expected a JSON object." });
  }
  const body = input as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const changes: Partial<Record<EditableField, string>> = {};

  for (const key of Object.keys(body)) {
    if (key !== "version" && key !== "force" && !(key in FIELDS)) {
      fields[key] = "This field cannot be changed.";
    }
  }

  let version = Buffer.alloc(0);
  if (typeof body.version !== "string" || body.version.length === 0) {
    fields.version = "Version is required.";
  } else {
    version = Buffer.from(body.version, "base64");
    if (version.length !== 8) fields.version = "Version is not valid.";
  }

  if (body.force !== undefined && typeof body.force !== "boolean") {
    fields.force = "Force must be true or false.";
  }

  for (const [key, spec] of Object.entries(FIELDS)) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (typeof raw !== "string") {
      fields[key] = `${spec.label} must be text.`;
      continue;
    }
    let value = key === "bodyHtml" ? sanitizeHtml(raw) : raw.trim();
    if (key === "slug") value = value.toLowerCase();
    if (spec.required && value.trim().length === 0) fields[key] = `${spec.label} is required.`;
    else if (value.length > spec.max) fields[key] = `${spec.label} is too long.`;
    else if (key === "slug" && !SLUG.test(value)) fields[key] = "URL slug can use lowercase letters, numbers, and hyphens.";
    else changes[key as EditableField] = value;
  }

  if (Object.keys(fields).length > 0) invalid(fields);
  return { version, force: body.force === true, changes };
}

function isDuplicateKey(error: unknown): boolean {
  const number = error && typeof error === "object" && "number" in error ? error.number : undefined;
  return number === 2601 || number === 2627;
}

async function currentLiveVersion(actor: PostActor, id: string, fallback?: string): Promise<string> {
  const live = await getPostById(actor, id);
  return live?.version ?? fallback ?? "";
}

async function currentPublishedVersion(actor: PostActor, id: string, fallback?: string): Promise<string> {
  const pending = await getPendingRevision(actor, id);
  if (pending) return pending.version;
  const live = await getPostById(actor, id);
  return live?.version ?? fallback ?? "";
}

/**
 * PATCH /api/posts/[id]. Draft posts are updated in place with a RowVersion check.
 * Published posts are handled by the pending-revision path (next commit).
 */
export async function updatePost(actor: PostActor, id: string, input: unknown): Promise<BlogPostDetail | PendingRevision> {
  const patch = parsePostPatch(input);
  if (patch.force && actor.role !== "admin") {
    throw new AuthError("Only an admin can force an update.", 403, "forbidden");
  }

  const current = await getPostById(actor, id);
  if (!current) throw new AuthError("Post not found.", 404, "not_found");
  if (current.status === "archived") throw new AuthError("This post is archived.", 409, "archived");
  if (current.status === "published") {
    return updatePublishedPost(actor, current, patch);
  }
  if (current.version !== patch.version.toString("base64")) {
    throw new AuthError("This post changed since you loaded it.", 409, "stale_version", {
      version: current.version,
    });
  }

  const changed = (Object.keys(patch.changes) as EditableField[]).filter(
    (key) => patch.changes[key] !== (current as unknown as Record<string, unknown>)[key],
  );
  if (changed.length === 0) return current;

  const sets = changed.map((key) => `${FIELDS[key].column} = @${key}`).join(", ");
  let rows: number;
  try {
    const result = await query(
      `UPDATE dbo.BlogPost
       SET ${sets}, UpdatedAt = SYSUTCDATETIME()
       WHERE Id = @id AND RowVersion = @version${actor.role === "guest" ? " AND AuthorId = @actorId" : ""}`,
      (request) => {
        request.input("id", sql.UniqueIdentifier, id);
        request.input("version", sql.VarBinary(8), patch.version);
        if (actor.role === "guest") request.input("actorId", sql.UniqueIdentifier, actor.id);
        for (const key of changed) request.input(key, FIELDS[key].type() as sql.ISqlType, patch.changes[key]);
      },
    );
    rows = result.rowsAffected[0] ?? 0;
  } catch (error) {
    if (isDuplicateKey(error)) throw new AuthError("That URL slug is already used.", 409, "slug_taken");
    throw error;
  }
  if (rows === 0) {
    const version = await currentLiveVersion(actor, id, current.version);
    throw new AuthError("This post changed since you loaded it.", 409, "stale_version", { version });
  }

  const updated = await getPostById(actor, id);
  if (!updated) throw new AuthError("Post not found.", 404, "not_found");
  return updated;
}

type Snapshot = Record<EditableField, string>;

function snapshotOf(source: BlogPostDetail | PendingRevision): Snapshot {
  return {
    title: source.title, slug: source.slug, summary: source.summary, tags: source.tags,
    seoTitle: source.seoTitle, seoKeywords: source.seoKeywords, bodyHtml: source.bodyHtml,
  };
}

/**
 * Edits to a live post never touch BlogPost (ADR-0002/0003). They create or update, in place,
 * the single pending PostRevision. `version` is the revision's RowVersion when one exists.
 */
async function updatePublishedPost(
  actor: PostActor,
  live: BlogPostDetail,
  patch: PostPatch,
): Promise<BlogPostDetail | PendingRevision> {
  const pending = await getPendingRevision(actor, live.id);
  const expected = pending ? pending.version : live.version;
  if (!patch.force && expected !== patch.version.toString("base64")) {
    const version = await currentPublishedVersion(actor, live.id, live.version);
    throw new AuthError("This post changed since you loaded it.", 409, "stale_version", { version });
  }

  const base = snapshotOf(pending ?? live);
  const changed = (Object.keys(patch.changes) as EditableField[]).filter((key) => patch.changes[key] !== base[key]);
  if (changed.length === 0) return pending ?? live;
  const next = { ...base, ...patch.changes } as Snapshot;

  if (changed.includes("slug")) {
    const taken = await query(
      `SELECT 1 AS hit FROM dbo.BlogPost WHERE Slug = @slug AND Id <> @id
       UNION ALL
       SELECT 1 FROM dbo.PostRevision WHERE Slug = @slug AND PostId <> @id AND State = 'pending'`,
      (request) => {
        request.input("slug", sql.VarChar(180), next.slug);
        request.input("id", sql.UniqueIdentifier, live.id);
      },
    );
    if (taken.recordset.length > 0) throw new AuthError("That URL slug is already used.", 409, "slug_taken");
  }

  const bindFields = (request: { input: (name: string, type: sql.ISqlType, value: unknown) => unknown }) => {
    for (const key of Object.keys(FIELDS) as EditableField[]) {
      request.input(key, FIELDS[key].type() as sql.ISqlType, next[key]);
    }
  };

  let rows = 0;
  try {
    if (pending) {
      const result = await query(
        `UPDATE dbo.PostRevision
         SET Title = @title, Slug = @slug, Summary = @summary, Tags = @tags, SeoTitle = @seoTitle,
             SeoKeywords = @seoKeywords, BodyHtml = @bodyHtml, AuthorId = @actorId, UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @revisionId AND State = 'pending'${patch.force ? "" : " AND RowVersion = @version"}`,
        (request) => {
          request.input("revisionId", sql.UniqueIdentifier, pending.id);
          request.input("actorId", sql.UniqueIdentifier, actor.id);
          if (!patch.force) request.input("version", sql.VarBinary(8), patch.version);
          bindFields(request);
        },
      );
      rows = result.rowsAffected[0] ?? 0;
    } else {
      const result = await query(
        `INSERT INTO dbo.PostRevision
           (Id, PostId, AuthorId, Title, Slug, Summary, Tags, SeoTitle, SeoKeywords, BodyHtml, State, BaseVersion)
         SELECT NEWID(), p.Id, @actorId, @title, @slug, @summary, @tags, @seoTitle, @seoKeywords, @bodyHtml,
           'pending', p.RowVersion
         FROM dbo.BlogPost AS p
         WHERE p.Id = @id AND p.Status = 'published'${patch.force ? "" : " AND p.RowVersion = @version"}`,
        (request) => {
          request.input("id", sql.UniqueIdentifier, live.id);
          request.input("actorId", sql.UniqueIdentifier, actor.id);
          if (!patch.force) request.input("version", sql.VarBinary(8), patch.version);
          bindFields(request);
        },
      );
      rows = result.rowsAffected[0] ?? 0;
    }
  } catch (error) {
    // IX_PostRevision_PendingPost: another request created the pending revision first.
    if (isDuplicateKey(error) && String((error as { message?: unknown }).message ?? "").includes("IX_PostRevision_PendingPost")) {
      const version = await currentPublishedVersion(actor, live.id, live.version);
      throw new AuthError("This post changed since you loaded it.", 409, "stale_version", { version });
    }
    throw error;
  }
  if (rows === 0) {
    const version = await currentPublishedVersion(actor, live.id, live.version);
    throw new AuthError("This post changed since you loaded it.", 409, "stale_version", { version });
  }

  const saved = await getPendingRevision(actor, live.id);
  if (!saved) throw new AuthError("Post not found.", 404, "not_found");
  return saved;
}
