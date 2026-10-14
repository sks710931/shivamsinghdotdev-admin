# ADR-0004: Publish workflow

Status: Accepted (14 Oct 2026). See [ADR-0001](ADR-0001-public-content-boundary.md), [ADR-0002](ADR-0002-published-edits-via-revision.md), and the [slice 3 contract](../contracts/slice3-public-api.md).

## Context

Only an admin may change what the public site shows. ADR-0002 stores that public copy on `BlogPost` and holds every in-progress edit of a published post in one pending `PostRevision`. ADR-0001 reads `BlogPost` through the public API and refreshes pages with a revalidate webhook, with ISR at 300 seconds when the webhook does not land.

`src/app/api/posts/` is list and create only. `POST /api/posts` copies `status` from the body, so a guest can store `published` (audit S1), and `BodyHtml` is written unsanitised (audit S2). `BlogPost` has no `PublishedAt`.

## Facts

- `requireAdmin` (`src/server/auth.ts`) returns 401 with no session and 403 for a guest. Roles are `admin` and `guest`.
- Founder rule (audit §9.3): a guest creates and edits their own posts; only an admin publishes, unpublishes, or archives.
- ADR-0002: publish is the only copy from the pending revision onto `BlogPost`. An archived post refuses publish with 409 `archived` and keeps its slug reserved.
- Audit decision 5 and ADR-0003: every save runs `sanitizeHtml`. Autosave of a published post updates the pending revision and leaves the live row unchanged.
- Slice 3: after a committed publish, unpublish, or archive, call `POST /api/public/revalidate` with `{ "slug", "event" }` where `event` is `publish`, `unpublish`, or `delete`. The call sits outside the write. A failed call leaves the row committed. Public pages set `revalidate = 300`. Draft save, autosave, and revision edit do not call it.

## Decision

These routes are admin-only. The admin role check runs before any DB read on all of them, so a guest receives 403 `{ "error": "Forbidden.", "code": "forbidden" }` for a real id and for a fake id alike. Errors are `{ "error": string, "code": string }`.

1. `POST /api/posts/[id]/publish`. A draft becomes `published`. Set `PublishedAt` to the current UTC time when it is null. When `PublishedAt` is already set, leave it. An archived post returns 409 `archived` and writes nothing, even with `force`.
2. `POST /api/posts/[id]/unpublish`. A published post becomes `draft`. `PublishedAt` stays. The same transaction marks any pending revision `State = 'discarded'`. The revision row and its content stay. The UI wording is "sets aside".
3. `POST /api/posts/[id]/revision/publish`. Body is `{ "version" }` and may include `force`. One `SERIALIZABLE` transaction copies the pending `PostRevision` fields onto `BlogPost` and marks the revision published. `version` must equal that revision's `RowVersion`. Any other value returns 409 `{ "code": "revision_stale" }` and writes nothing. The revision `BaseVersion` must equal the live `BlogPost.RowVersion`; otherwise the transaction writes nothing and returns 409 `{ "code": "revision_stale" }`. An admin `force: true` may override that BaseVersion `revision_stale` only when the post is currently `published`. On an archived post, publish returns 409 `archived` even with `force`.
4. `DELETE /api/posts/[id]/revision`. Discard the pending revision: `State = 'discarded'`. `BlogPost` stays as it is.
5. `POST /api/posts/[id]/archive`. The post becomes archived. The slug stays reserved. A later publish returns 409 `archived` even with `force`. The same transaction marks any pending revision `State = 'discarded'`. The revision row and its content stay. The UI wording is "sets aside".

Publish and revision publish run `sanitizeHtml` on `bodyHtml` again inside the transaction, before the live write (defence in depth).

Slice 1 does not redirect a slug that a live post leaves behind.

After commit, enqueue the slice 3 revalidate webhook outside the transaction. The enqueue is best-effort: one call, no new queue, and a failed call leaves the committed row in place. ISR at 300 seconds is the fallback. Publish and revision publish send `event` `publish` for the slug just written. Unpublish sends `unpublish`. Archive sends `delete`. Discard does not enqueue.

## Consequences

- `POST /api/posts` and `PATCH` leave `Status` at `draft`, or keep the edit on the pending revision, when the body says `published`. The five routes above are the public transitions. That closes S1.
- Live `bodyHtml` is the sanitiser output at publish time, including HTML saved before the sanitiser existed.
- A lost webhook leaves the previous public page for at most 300 seconds. The old slug has no redirect, so after that window it is a public 404 and the new slug is the live URL.
- A discarded revision and a `revision_stale` response leave `BlogPost` byte-identical. Neither enqueues a webhook.
- `PublishedAt` is the first publish time. Unpublish and a later publish keep it, so public `publishedAt` order stays stable.

## Open questions

- Slug change on a live post: slice 1 does not redirect the old slug. A later redirect is open.
- Audit columns `PublishedBy` and `UpdatedBy` are out of this slice. Whether to add them is open.

## Gate tests

1. A guest receives 403 `forbidden` on all five routes, and `BlogPost` is unchanged. No session receives 401.
2. Publish on a draft with null `PublishedAt` sets `published` and `PublishedAt`. Unpublish, then publish again, leaves that `PublishedAt` and returns the post to `published`.
3. Unpublish sets `draft` and keeps `PublishedAt`.
4. Revision publish copies the pending fields onto `BlogPost` and marks the revision published, in one transaction. A `version` other than the revision `RowVersion` returns 409 `revision_stale` with both rows unchanged.
5. Publish and revision publish store `sanitizeHtml(bodyHtml)`. An injected `<script>` or `onerror` is absent from the live HTML.
6. Discard sets `State` to `'discarded'` and leaves `BlogPost` byte-identical.
7. Archive reserves the slug, omits the post from the public API, and a later publish returns 409 `archived`.
8. The webhook is enqueued only after commit, for publish, revision publish, unpublish, and archive, with slice 3 events `publish`, `unpublish`, and `delete`. A webhook error leaves the committed row. Discard, draft save, and revision edit do not enqueue.
9. A revision publish that changes the slug writes the new slug and stores no redirect from the old slug.
10. On all five routes the admin role check runs before any DB read. A guest receives 403 `forbidden` for a real id and for a fake id, with the same body, and `BlogPost` is unchanged.
11. Unpublish and archive each mark any pending revision `State = 'discarded'` in the same transaction as the `BlogPost` write. The revision row and its content stay. The UI wording is "sets aside".
12. Revision publish returns 409 `revision_stale` and writes nothing when the revision `BaseVersion` does not equal the live `BlogPost.RowVersion`. An admin `force: true` overrides that `revision_stale` only when the post is currently `published`. Publish of an archived post returns 409 `archived` even with `force`.
