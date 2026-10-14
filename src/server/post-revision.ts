import "server-only";

import { query, sql } from "@/server/db";
import type { PostActor } from "@/server/posts";

export type PendingRevision = {
  id: string; postId: string; authorId: string; title: string; slug: string; summary: string; tags: string;
  seoTitle: string; seoKeywords: string; bodyHtml: string; baseVersion: string; version: string;
  createdAt: string; updatedAt: string;
};

const iso = (v: unknown) => (v instanceof Date ? v : new Date(String(v ?? ""))).toISOString();
const b64 = (v: unknown) => (Buffer.isBuffer(v) ? v.toString("base64") : "");

/** GET /api/posts/[id]/revision. Contract v1.1: `version` is the revision's RowVersion. Guests only see their own posts. */
export async function getPendingRevision(actor: PostActor, postId: string): Promise<PendingRevision | null> {
  const guestOnly = actor.role === "guest";
  const result = await query<Record<string, unknown>>(
    `SELECT r.Id, r.PostId, r.AuthorId, r.Title, r.Slug, r.Summary, r.Tags, r.SeoTitle, r.SeoKeywords,
       r.BodyHtml, r.BaseVersion, CAST(r.RowVersion AS binary(8)) AS RowVersion, r.CreatedAt, r.UpdatedAt
     FROM dbo.PostRevision AS r
     INNER JOIN dbo.BlogPost AS p ON p.Id = r.PostId
     WHERE r.PostId = @postId AND r.State = 'pending'${guestOnly ? " AND p.AuthorId = @actorId" : ""}`,
    (request) => {
      request.input("postId", sql.UniqueIdentifier, postId);
      if (guestOnly) request.input("actorId", sql.UniqueIdentifier, actor.id);
    },
  );
  const r = result.recordset[0];
  if (!r) return null;
  return {
    id: String(r.Id), postId: String(r.PostId), authorId: String(r.AuthorId),
    title: String(r.Title ?? ""), slug: String(r.Slug ?? ""), summary: String(r.Summary ?? ""),
    tags: String(r.Tags ?? ""), seoTitle: String(r.SeoTitle ?? ""), seoKeywords: String(r.SeoKeywords ?? ""),
    bodyHtml: String(r.BodyHtml ?? ""), baseVersion: b64(r.BaseVersion), version: b64(r.RowVersion),
    createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt),
  };
}
