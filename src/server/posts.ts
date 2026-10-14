import "server-only";

import { randomUUID } from "node:crypto";

import type { AdminUser } from "@/server/auth";

export type PostActor = Pick<AdminUser, "id" | "role">;
import { AuthError } from "@/server/auth-error";
import { sql, query } from "@/server/db";
import { sanitizeHtml } from "@/server/sanitize";

export type PostStatus = "draft" | "published";

export type BlogPostSummary = {
  id: string;
  title: string;
  slug: string;
  status: PostStatus;
  updatedAt: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function field(row: Record<string, unknown>, name: string): unknown {
  if (name in row) {
    return row[name];
  }
  const match = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? row[match] : undefined;
}

function text(value: unknown, label: string, max: number, required: boolean): string {
  if (typeof value !== "string") {
    if (!required) {
      return "";
    }
    throw new AuthError(`${label} is required.`, 400);
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    throw new AuthError(`${label} is required.`, 400);
  }
  if (trimmed.length > max) {
    throw new AuthError(`${label} is too long.`, 400);
  }
  return trimmed;
}

export async function ensurePostSchema(): Promise<void> {
  await query(`
    IF OBJECT_ID(N'dbo.BlogPost', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.BlogPost (
        Id uniqueidentifier NOT NULL CONSTRAINT PK_BlogPost PRIMARY KEY,
        Title nvarchar(200) NOT NULL,
        Slug varchar(180) NOT NULL,
        Summary nvarchar(500) NOT NULL CONSTRAINT DF_BlogPost_Summary DEFAULT N'',
        Tags nvarchar(500) NOT NULL CONSTRAINT DF_BlogPost_Tags DEFAULT N'',
        SeoKeywords nvarchar(500) NOT NULL CONSTRAINT DF_BlogPost_SeoKeywords DEFAULT N'',
        SeoTitle nvarchar(200) NOT NULL CONSTRAINT DF_BlogPost_SeoTitle DEFAULT N'',
        BodyHtml nvarchar(max) NOT NULL,
        Status varchar(20) NOT NULL CONSTRAINT DF_BlogPost_Status DEFAULT 'draft',
        AuthorId uniqueidentifier NOT NULL,
        CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_BlogPost_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt datetimeoffset NOT NULL CONSTRAINT DF_BlogPost_UpdatedAt DEFAULT SYSUTCDATETIME(),
        PublishedAt datetimeoffset NULL,
        CONSTRAINT UQ_BlogPost_Slug UNIQUE (Slug),
        CONSTRAINT FK_BlogPost_Author FOREIGN KEY (AuthorId) REFERENCES dbo.AdminUser (Id)
      );
      CREATE INDEX IX_BlogPost_UpdatedAt ON dbo.BlogPost (UpdatedAt DESC);
    END
  `);

  await query(`
    IF COL_LENGTH(N'dbo.BlogPost', N'PublishedAt') IS NULL
      ALTER TABLE dbo.BlogPost ADD PublishedAt datetimeoffset NULL;
  `);

  await query(`
    IF OBJECT_ID(N'dbo.PostRevision', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PostRevision (
        Id uniqueidentifier NOT NULL CONSTRAINT PK_PostRevision PRIMARY KEY,
        PostId uniqueidentifier NOT NULL,
        AuthorId uniqueidentifier NOT NULL,
        Title nvarchar(200) NOT NULL,
        Slug varchar(180) NOT NULL,
        Summary nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_Summary DEFAULT N'',
        Tags nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_Tags DEFAULT N'',
        SeoTitle nvarchar(200) NOT NULL CONSTRAINT DF_PostRevision_SeoTitle DEFAULT N'',
        SeoKeywords nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_SeoKeywords DEFAULT N'',
        BodyHtml nvarchar(max) NOT NULL,
        State varchar(20) NOT NULL,
        BaseVersion bigint NOT NULL CONSTRAINT DF_PostRevision_BaseVersion DEFAULT 0,
        RowVersion bigint NOT NULL CONSTRAINT DF_PostRevision_RowVersion DEFAULT 0,
        CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_PostRevision_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt datetimeoffset NOT NULL CONSTRAINT DF_PostRevision_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_PostRevision_Post FOREIGN KEY (PostId) REFERENCES dbo.BlogPost (Id),
        CONSTRAINT FK_PostRevision_Author FOREIGN KEY (AuthorId) REFERENCES dbo.AdminUser (Id),
        CONSTRAINT CK_PostRevision_State CHECK (State IN ('pending', 'published', 'discarded'))
      );
      CREATE UNIQUE INDEX UX_PostRevision_OnePending ON dbo.PostRevision (PostId) WHERE State = 'pending';
    END
  `);
}

export type ListPostStatus = PostStatus | "archived";

export type ListPostsOptions = {
  status?: ListPostStatus;
  pending?: boolean;
  page?: number;
  pageSize?: number;
  authorId?: string;
};

export type BlogPostListItem = {
  id: string;
  title: string;
  slug: string;
  status: ListPostStatus;
  hasPendingRevision: boolean;
  authorName: string;
  updatedAt: string;
  publishedAt: string | null;
};

const PENDING_REVISION = `EXISTS (
  SELECT 1
  FROM dbo.PostRevision AS r
  WHERE r.PostId = p.Id AND r.State = 'pending'
)`;

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return date.toISOString();
}

function timestampOrNull(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function listStatus(value: unknown): ListPostStatus {
  if (value === "published" || value === "archived" || value === "draft") {
    return value;
  }
  return "draft";
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export async function listPosts(actor: PostActor): Promise<BlogPostListItem[]>;
export async function listPosts(actor: PostActor, options: ListPostsOptions): Promise<{ items: BlogPostListItem[]; total: number }>;
export async function listPosts(
  actor: PostActor,
  options?: ListPostsOptions,
): Promise<BlogPostListItem[] | { items: BlogPostListItem[]; total: number }> {
  await ensurePostSchema();

  const paginate = options !== undefined;
  const page = options?.page && Number.isInteger(options.page) && options.page > 0 ? options.page : 1;
  const pageSize =
    options?.pageSize && Number.isInteger(options.pageSize) && options.pageSize > 0
      ? Math.min(options.pageSize, 100)
      : 20;
  const status =
    options?.status === "draft" || options?.status === "published" || options?.status === "archived"
      ? options.status
      : undefined;
  const authorId = actor.role === "guest" ? actor.id : options?.authorId || undefined;
  const pending = options?.pending;

  const filters: string[] = [];
  if (status) {
    filters.push("p.Status = @status");
  }
  if (authorId) {
    filters.push("p.AuthorId = @authorId");
  }
  if (pending === true) {
    filters.push(PENDING_REVISION);
  } else if (pending === false) {
    filters.push(`NOT ${PENDING_REVISION}`);
  }
  const whereSql = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const bindFilters = (request: { input: (name: string, type: unknown, value: unknown) => void }) => {
    if (status) {
      request.input("status", sql.VarChar(20), status);
    }
    if (authorId) {
      request.input("authorId", sql.UniqueIdentifier, authorId);
    }
  };

  const count = paginate
    ? await query<Record<string, unknown>>(
        `SELECT COUNT(*) AS total
         FROM dbo.BlogPost AS p
         ${whereSql}`,
        (request) => {
          bindFilters(request);
        },
      )
    : undefined;

  const result = await query<Record<string, unknown>>(
    `SELECT
       p.Id AS id,
       p.Title AS title,
       p.Slug AS slug,
       p.Status AS status,
       p.UpdatedAt AS updatedAt,
       p.PublishedAt AS publishedAt,
       COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)), N''), u.Email, N'') AS authorName,
       CASE WHEN ${PENDING_REVISION} THEN 1 ELSE 0 END AS hasPendingRevision
     FROM dbo.BlogPost AS p
     INNER JOIN dbo.AdminUser AS u ON u.Id = p.AuthorId
     ${whereSql}
     ORDER BY p.UpdatedAt DESC, p.Id ASC
     ${paginate ? "OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY" : ""}`,
    (request) => {
      bindFilters(request);
      if (paginate) {
        request.input("offset", sql.Int, (page - 1) * pageSize);
        request.input("pageSize", sql.Int, pageSize);
      }
    },
  );

  const items = result.recordset.map((row) => ({
    id: String(field(row, "id") ?? ""),
    title: String(field(row, "title") ?? ""),
    slug: String(field(row, "slug") ?? ""),
    status: listStatus(field(row, "status")),
    hasPendingRevision: flag(field(row, "hasPendingRevision")),
    authorName: String(field(row, "authorName") ?? ""),
    updatedAt: timestamp(field(row, "updatedAt")),
    publishedAt: timestampOrNull(field(row, "publishedAt")),
  }));

  if (!paginate) {
    return items;
  }

  const total = Number(field(count?.recordset[0] ?? {}, "total") ?? 0);
  return {
    items,
    total: Number.isFinite(total) ? total : 0,
  };
}

export async function createPost(
  actor: PostActor,
  input: unknown,
): Promise<{ id: string; slug: string }> {
  if (!input || typeof input !== "object") {
    throw new AuthError("Expected a post.", 400);
  }
  const body = input as Record<string, unknown>;
  const title = text(body.title, "Title", 200, true);
  const slug = text(body.slug, "URL slug", 180, true).toLowerCase();
  if (!SLUG.test(slug)) {
    throw new AuthError("URL slug can use lowercase letters, numbers, and hyphens.", 400);
  }
  const summary = text(body.summary, "Summary", 500, false);
  const tags = text(body.tags, "Tags", 500, false);
  const seoKeywords = text(body.seoKeywords, "SEO keywords", 500, false);
  const seoTitle = text(body.seoTitle, "SEO title", 200, false);
  const html = sanitizeHtml(text(body.bodyHtml, "Body", 200_000, true));
  if (html.trim().length === 0) throw new AuthError("Body is required.", 400, "validation");
  // Guests can never publish on create (Sentinel P1).
  const status: PostStatus = actor.role === "admin" && body.status === "published" ? "published" : "draft";
  const authorId = actor.id;

  await ensurePostSchema();
  const id = randomUUID();
  try {
    await query(
      `INSERT INTO dbo.BlogPost
        (Id, Title, Slug, Summary, Tags, SeoKeywords, SeoTitle, BodyHtml, Status, AuthorId)
       VALUES
        (@id, @title, @slug, @summary, @tags, @seoKeywords, @seoTitle, @bodyHtml, @status, @authorId)`,
      (request) => {
        request.input("id", sql.UniqueIdentifier, id);
        request.input("title", sql.NVarChar(200), title);
        request.input("slug", sql.VarChar(180), slug);
        request.input("summary", sql.NVarChar(500), summary);
        request.input("tags", sql.NVarChar(500), tags);
        request.input("seoKeywords", sql.NVarChar(500), seoKeywords);
        request.input("seoTitle", sql.NVarChar(200), seoTitle);
        request.input("bodyHtml", sql.NVarChar(sql.MAX), html);
        request.input("status", sql.VarChar(20), status);
        request.input("authorId", sql.UniqueIdentifier, authorId);
      },
    );
  } catch (error) {
    const number = error && typeof error === "object" && "number" in error ? error.number : undefined;
    if (number === 2601 || number === 2627) {
      throw new AuthError("That URL slug is already used.", 409);
    }
    throw error;
  }

  return { id, slug };
}
export type BlogPostDetail = {
  id: string; title: string; slug: string; summary: string; tags: string; seoKeywords: string; seoTitle: string;
  bodyHtml: string; status: ListPostStatus; authorId: string; authorName: string; hasPendingRevision: boolean;
  version: string; updatedAt: string; publishedAt: string | null;
};

export async function getPostById(actor: PostActor, id: string): Promise<BlogPostDetail | null> {
  const guestOnly = actor.role === "guest";
  const result = await query<Record<string, unknown>>(
    `SELECT p.Id AS id, p.Title AS title, p.Slug AS slug, p.Summary AS summary, p.Tags AS tags,
       p.SeoKeywords AS seoKeywords, p.SeoTitle AS seoTitle, p.BodyHtml AS bodyHtml, p.Status AS status,
       p.AuthorId AS authorId, p.RowVersion AS rowVersion, p.UpdatedAt AS updatedAt, p.PublishedAt AS publishedAt,
       COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)), N''), u.Email, N'') AS authorName,
       CASE WHEN ${PENDING_REVISION} THEN 1 ELSE 0 END AS hasPendingRevision
     FROM dbo.BlogPost AS p
     INNER JOIN dbo.AdminUser AS u ON u.Id = p.AuthorId
     WHERE p.Id = @id${guestOnly ? " AND p.AuthorId = @actorId" : ""}`,
    (request) => {
      request.input("id", sql.UniqueIdentifier, id);
      if (guestOnly) {
        request.input("actorId", sql.UniqueIdentifier, actor.id);
      }
    },
  );
  const row = result.recordset[0];
  if (!row) return null;
  const authorId = String(field(row, "authorId") ?? "");
  const rv = field(row, "rowVersion");
  return {
    id: String(field(row, "id") ?? ""),
    title: String(field(row, "title") ?? ""),
    slug: String(field(row, "slug") ?? ""),
    summary: String(field(row, "summary") ?? ""),
    tags: String(field(row, "tags") ?? ""),
    seoKeywords: String(field(row, "seoKeywords") ?? ""),
    seoTitle: String(field(row, "seoTitle") ?? ""),
    bodyHtml: String(field(row, "bodyHtml") ?? ""),
    status: listStatus(field(row, "status")),
    authorId,
    authorName: String(field(row, "authorName") ?? ""),
    hasPendingRevision: flag(field(row, "hasPendingRevision")),
    version: Buffer.isBuffer(rv) ? rv.toString("base64") : Buffer.from(String(rv ?? "")).toString("base64"),
    updatedAt: timestamp(field(row, "updatedAt")),
    publishedAt: timestampOrNull(field(row, "publishedAt")),
  };
}
