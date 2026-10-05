import "server-only";

import { randomUUID } from "node:crypto";

import { AuthError } from "@/server/auth-error";
import { sql, query } from "@/server/db";

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
        CONSTRAINT UQ_BlogPost_Slug UNIQUE (Slug),
        CONSTRAINT FK_BlogPost_Author FOREIGN KEY (AuthorId) REFERENCES dbo.AdminUser (Id)
      );
      CREATE INDEX IX_BlogPost_UpdatedAt ON dbo.BlogPost (UpdatedAt DESC);
    END
  `);
}

export async function listPosts(): Promise<BlogPostSummary[]> {
  await ensurePostSchema();
  const result = await query<Record<string, unknown>>(`
    SELECT Id, Title, Slug, Status, UpdatedAt
    FROM dbo.BlogPost
    ORDER BY UpdatedAt DESC
  `);
  return result.recordset.map((row) => ({
    id: String(field(row, "id") ?? ""),
    title: String(field(row, "title") ?? ""),
    slug: String(field(row, "slug") ?? ""),
    status: field(row, "status") === "published" ? "published" : "draft",
    updatedAt: new Date(String(field(row, "updatedAt") ?? "")).toISOString(),
  }));
}

export async function createPost(
  authorId: string,
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
  const html = text(body.bodyHtml, "Body", 200_000, true);
  const status: PostStatus = body.status === "published" ? "published" : "draft";

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
