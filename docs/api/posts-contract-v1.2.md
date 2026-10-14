# Posts API contract v1.2 (delta on v1.1)

Owner: Forge. Agreed in the team room 14 Oct 2026; matches ADR-0004 (#12) and the ADR-0002 version addendum.
Everything in v1.1 stands unless changed here. Errors keep the shape `{ error, code }`.

## Endpoints

| Method | Path | Who | Body | Success |
|---|---|---|---|---|
| GET | `/api/posts/[id]` | any (guest: own posts) | | live post; `version` = BlogPost RowVersion |
| PATCH | `/api/posts/[id]` | any (guest: own posts) | `{ version, force?, ...fields }` | draft: updated post. Published: the pending revision |
| GET | `/api/posts/[id]/revision` | any (guest: own posts) | | pending revision; `version` = revision RowVersion |
| DELETE | `/api/posts/[id]/revision` | admin | `{ version }` (revision's) | live post; revision set aside (row kept) |
| POST | `/api/posts/[id]/publish` | admin | `{ version }` | drafts only |
| POST | `/api/posts/[id]/revision/publish` | admin | `{ version, force? }` (revision's version) | live post with revision copied in |
| POST | `/api/posts/[id]/unpublish` | admin | `{ version }` | post back to draft; pending revision set aside |
| POST | `/api/posts/[id]/archive` | admin | `{ version }` | archived; pending revision set aside |

Removed: `DELETE /api/posts/[id]` (use `/archive`), and the `revisionVersion` field on `/publish`.

## Rules

- Admin-only endpoints check the role before any lookup: a guest gets 403 `forbidden` for a real or a fake id.
- Clients send back the last `version` they received from the endpoint they are editing.
- `PublishedAt` is set on first publish only; a republished post keeps its original date.
- `revision/publish`: the revision's `BaseVersion` must equal the live post's version, else 409 `revision_stale`.
  `force` overrides that only while the post is published. An archived post is always 409 `archived`.
- The body is sanitised on every write and again at publish.

## Error codes added in v1.2

| Status | Code | When |
|---|---|---|
| 409 | `not_draft` | `/publish` on a post that isn't a draft (use `revision/publish` for live posts) |
| 409 | `not_published` | `/unpublish` or `revision/publish` on a post that isn't published |
| 409 | `slug_taken` | also from `revision/publish`, when another post took the revision's slug |
| 403 | `forbidden` | non-admin on any admin-only endpoint, or non-admin `force` on PATCH |

## v1.2.1 (additive, 14 Oct 2026)

POST /api/posts now also returns 'version' (the new BlogPost RowVersion, base64) alongside 'id' and 'slug', with 201; this is additive and backward compatible; clients keep a fallback GET /api/posts/[id] until the server ships it; it lets the first autosave (ADR-0003) PATCH immediately. Also note that GET /api/posts list items include hasPendingRevision.
