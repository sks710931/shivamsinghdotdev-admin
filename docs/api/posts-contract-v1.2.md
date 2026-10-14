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

- Route table additions: 'GET /api/posts' (any; guest sees own posts; list items include hasPendingRevision) and 'POST /api/posts' (any; creates a draft; returns 201 with id, slug, version).
- POST /api/posts always creates status draft and ignores any status in the body for every role, including admin; the only ways to go live are the ADR-0004 transition routes.
- For a guest, another user's post and a nonexistent id both return 404 not_found with an identical body on GET /api/posts/[id], PATCH /api/posts/[id] and GET /api/posts/[id]/revision, so existence is not disclosed.
- A stale version on PATCH returns 409 stale_version and the error body also includes the current 'version' so the client can offer reload.
- Clients keep a fallback GET after create until the server ships version in the create response.
- An anonymous caller (no session) gets 401 unauthorized on every /api/posts route, before any id check or database read.

## v1.2.2

- New POST /api/posts response: HTTP 500 with flat body `{id, slug, error, code: "post_saved_version_failed"}`, returned when the draft was committed but its version could not be encoded. State: the draft WAS created; clients must treat it as saved, navigate to it by id, GET it once to obtain version, and must NOT retry the create.

