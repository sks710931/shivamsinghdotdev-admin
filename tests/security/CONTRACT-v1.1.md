# Slice 1 posts API contract (draft v1, Forge)
Data: BlogPost = live row. PostRevision(Id, PostId, AuthorId, Title, Slug, Summary, Tags, SeoTitle, SeoKeywords, BodyHtml, State pending|published|discarded, BaseVersion, RowVersion, CreatedAt, UpdatedAt); filtered unique index: one pending per PostId.
Routing rule: draft post -> PATCH writes BlogPost. Published post + guest -> PATCH upserts the pending revision. Published post + admin -> writes live.
Guest scope: every query filters AuthorId = me; other author's post -> 404.
Errors: { error: string, code: string, ... } (keeps existing `error` field).
 400 validation {fields:{name:msg}} | 403 forbidden | 404 not_found | 409 stale_version {currentVersion, updatedAt, updatedBy} | 409 slug_taken
Endpoints:
 GET    /api/posts?status=draft|published|archived&pending=true&page=1&pageSize=20 -> {items:[{id,title,slug,status,hasPendingRevision,authorName,updatedAt,publishedAt}], total}
 GET    /api/posts/[id] -> {id,title,slug,summary,tags:string[],seoTitle,seoKeywords:string[],bodyHtml,status,authorId,authorName,createdAt,updatedAt,publishedAt,version, pendingRevision:{id,authorName,updatedAt}|null}
 PATCH  /api/posts/[id] {version, title?, slug?, summary?, tags?, seoTitle?, seoKeywords?, bodyHtml?} (allow-listed fields only; slug locked once published) -> {appliedTo:"live"|"pendingRevision", version, revisionId?, updatedAt}
 GET    /api/posts/[id]/revision -> same shape as post + {revisionId, version, baseVersion, liveChangedSinceBase:boolean}
 DELETE /api/posts/[id]/revision {version} (admin or revision author) -> 204
 POST   /api/posts/[id]/publish {version, revisionVersion?} admin -> publishes draft or applies pending revision -> {version, publishedAt}
 POST   /api/posts/[id]/unpublish {version} admin -> {version}
 DELETE /api/posts/[id] {version} admin -> archive (soft); 204
All bodyHtml sanitised server-side on every save, all roles.

## Amendment v1.1 (accepted Sentinel objection + edge cases, Nexus condition)
- Routing: draft -> live row. Published post -> ALWAYS pending revision, all roles. Admin "Update live post" = publish revision. PATCH appliedTo is "live" only for drafts.
- POST /publish with pending revision: single SERIALIZABLE-free transaction: UPDATE BlogPost ... WHERE Id=@id AND RowVersion=@version; 0 rows -> 409 stale_version. If revision.BaseVersion != live RowVersion -> 409 code "revision_stale" unless body {force:true}.
- Unpublish/archive keeps pending revision. Publish onto archived post -> 409 code "archived". Archived never in public API; slug stays reserved (unique constraint unchanged).
