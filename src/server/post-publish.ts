import "server-only";

import { AuthError } from "@/server/auth-error";
import { sql, withTransaction } from "@/server/db";
import { getPostById, type BlogPostDetail, type PostActor } from "@/server/posts";
import { sanitizeHtml } from "@/server/sanitize";

// ADR-0004 (contract v1.2). Every function checks the role before any database read,
// so a guest gets the same 403 for a real or a fake id.

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAdmin(actor: PostActor): void {
  if (actor.role !== "admin") throw new AuthError("Only an admin can do this.", 403, "forbidden");
}

function notFound(): never {
  throw new AuthError("Post not found.", 404, "not_found");
}

function readBody(input: unknown): { version: Buffer; force: boolean } {
  const body = (input && typeof input === "object" ? input : {}) as Row;
  const version = typeof body.version === "string" ? Buffer.from(body.version, "base64") : Buffer.alloc(0);
  if (version.length !== 8) throw new AuthError("Version is required.", 400, "validation");
  if (body.force !== undefined && typeof body.force !== "boolean") {
    throw new AuthError("Force must be true or false.", 400, "validation");
  }
  return { version, force: body.force === true };
}

const same = (a: unknown, b: Buffer) => Buffer.isBuffer(a) && a.equals(b);

async function lockPost(tx: sql.Transaction, id: string): Promise<Row> {
  const r = await new sql.Request(tx)
    .input("id", sql.UniqueIdentifier, id)
    .query<Row>(
      `SELECT Id, Status, BodyHtml, RowVersion FROM dbo.BlogPost WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id`,
    );
  return r.recordset[0] ?? notFound();
}

async function setAsidePending(tx: sql.Transaction, id: string): Promise<void> {
  await new sql.Request(tx)
    .input("id", sql.UniqueIdentifier, id)
    .query(`UPDATE dbo.PostRevision SET State = 'discarded', UpdatedAt = SYSUTCDATETIME()
            WHERE PostId = @id AND State = 'pending'`);
}

async function done(actor: PostActor, id: string): Promise<BlogPostDetail> {
  return (await getPostById(actor, id)) ?? notFound();
}

function checkId(id: string): void {
  if (!UUID.test(id)) notFound();
}

/** POST [id]/publish: drafts only. The body is sanitised again at publish time. */
export async function publishPost(actor: PostActor, id: string, input: unknown): Promise<BlogPostDetail> {
  requireAdmin(actor);
  checkId(id);
  const { version } = readBody(input);
  await withTransaction(async (tx) => {
    const post = await lockPost(tx, id);
    if (post.Status === "archived") throw new AuthError("This post is archived.", 409, "archived");
    if (post.Status !== "draft") throw new AuthError("Only a draft can be published.", 409, "not_draft");
    if (!same(post.RowVersion, version)) throw new AuthError("This post changed since you loaded it.", 409, "stale_version");
    await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, id)
      .input("body", sql.NVarChar(sql.MAX), sanitizeHtml(String(post.BodyHtml ?? "")))
      .query(`UPDATE dbo.BlogPost
              SET Status = 'published', BodyHtml = @body, PublishedAt = COALESCE(PublishedAt, SYSUTCDATETIME()), UpdatedAt = SYSUTCDATETIME()
              WHERE Id = @id`);
  });
  return done(actor, id);
}

/** POST [id]/unpublish: published back to draft; any pending revision is set aside in the same transaction. */
export async function unpublishPost(actor: PostActor, id: string, input: unknown): Promise<BlogPostDetail> {
  requireAdmin(actor);
  checkId(id);
  const { version } = readBody(input);
  await withTransaction(async (tx) => {
    const post = await lockPost(tx, id);
    if (post.Status === "archived") throw new AuthError("This post is archived.", 409, "archived");
    if (post.Status !== "published") throw new AuthError("Only a published post can be unpublished.", 409, "not_published");
    if (!same(post.RowVersion, version)) throw new AuthError("This post changed since you loaded it.", 409, "stale_version");
    await setAsidePending(tx, id);
    await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, id)
      .query(`UPDATE dbo.BlogPost SET Status = 'draft', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`);
  });
  return done(actor, id);
}

/** POST [id]/archive: replaces DELETE [id]. Any pending revision is set aside in the same transaction. */
export async function archivePost(actor: PostActor, id: string, input: unknown): Promise<BlogPostDetail> {
  requireAdmin(actor);
  checkId(id);
  const { version } = readBody(input);
  await withTransaction(async (tx) => {
    const post = await lockPost(tx, id);
    if (post.Status === "archived") throw new AuthError("This post is archived.", 409, "archived");
    if (!same(post.RowVersion, version)) throw new AuthError("This post changed since you loaded it.", 409, "stale_version");
    await setAsidePending(tx, id);
    await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, id)
      .query(`UPDATE dbo.BlogPost SET Status = 'archived', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`);
  });
  return done(actor, id);
}

/**
 * POST [id]/revision/publish: `version` is the revision's RowVersion. The revision's BaseVersion must match
 * the live post (409 revision_stale); `force` overrides that only while the post is published. Archived is always 409.
 */
export async function publishRevision(actor: PostActor, id: string, input: unknown): Promise<BlogPostDetail> {
  requireAdmin(actor);
  checkId(id);
  const { version, force } = readBody(input);
  await withTransaction(async (tx) => {
    const post = await lockPost(tx, id);
    if (post.Status === "archived") throw new AuthError("This post is archived.", 409, "archived");
    const rev = (
      await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, id)
        .query<Row>(
          `SELECT Id, Title, Slug, Summary, Tags, SeoTitle, SeoKeywords, BodyHtml, BaseVersion,
             CAST(RowVersion AS binary(8)) AS RowVersion
           FROM dbo.PostRevision WITH (UPDLOCK, HOLDLOCK) WHERE PostId = @id AND State = 'pending'`,
        )
    ).recordset[0];
    if (!rev) throw new AuthError("Revision not found.", 404, "not_found");
    if (!same(rev.RowVersion, version)) throw new AuthError("This revision changed since you loaded it.", 409, "stale_version");
    if (!same(rev.BaseVersion, post.RowVersion as Buffer) && !(force && post.Status === "published")) {
      throw new AuthError("The live post changed after this revision was started.", 409, "revision_stale");
    }
    if (post.Status !== "published") throw new AuthError("Only a published post has revisions to publish.", 409, "not_published");
    try {
      await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, id)
        .input("title", sql.NVarChar(200), rev.Title)
        .input("slug", sql.VarChar(180), rev.Slug)
        .input("summary", sql.NVarChar(500), rev.Summary)
        .input("tags", sql.NVarChar(500), rev.Tags)
        .input("seoTitle", sql.NVarChar(200), rev.SeoTitle)
        .input("seoKeywords", sql.NVarChar(500), rev.SeoKeywords)
        .input("body", sql.NVarChar(sql.MAX), sanitizeHtml(String(rev.BodyHtml ?? "")))
        .query(`UPDATE dbo.BlogPost
                SET Title = @title, Slug = @slug, Summary = @summary, Tags = @tags, SeoTitle = @seoTitle,
                    SeoKeywords = @seoKeywords, BodyHtml = @body, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @id`);
    } catch (error) {
      const n = error && typeof error === "object" && "number" in error ? error.number : undefined;
      const msg = error && typeof error === "object" && "message" in error ? String(error.message) : "";
      if ((n === 2601 || n === 2627) && msg.includes("UQ_BlogPost_Slug")) {
        throw new AuthError("That URL slug is already used.", 409, "slug_taken");
      }
      throw error;
    }
    await new sql.Request(tx)
      .input("rid", sql.UniqueIdentifier, rev.Id)
      .query(`UPDATE dbo.PostRevision SET State = 'published', UpdatedAt = SYSUTCDATETIME() WHERE Id = @rid`);
  });
  return done(actor, id);
}

/** DELETE [id]/revision: sets the pending revision aside (the row is kept). `version` is the revision's. */
export async function discardRevision(actor: PostActor, id: string, input: unknown): Promise<BlogPostDetail> {
  requireAdmin(actor);
  checkId(id);
  const { version } = readBody(input);
  await withTransaction(async (tx) => {
    await lockPost(tx, id);
    const r = await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, id)
      .input("version", sql.VarBinary(8), version)
      .query(`UPDATE dbo.PostRevision SET State = 'discarded', UpdatedAt = SYSUTCDATETIME()
              WHERE PostId = @id AND State = 'pending' AND RowVersion = @version`);
    if ((r.rowsAffected[0] ?? 0) === 0) {
      throw new AuthError("No matching pending revision.", 409, "stale_version");
    }
  });
  return done(actor, id);
}
