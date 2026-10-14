# Posts API Contract v1.2 Authorization & Gate-Test Matrix

This document defines the authorization and gate-test matrix for the Posts API contract v1.2.
Sources: `docs/api/posts-contract-v1.2.md` and `docs/decisions/ADR-0004-publish-workflow.md` (Gate tests 1–12) only.
Any rule, status, or error code not explicitly defined in these sources is marked as `unspecified in v1.2`.

---

## 1. Security & Authorization Rules (v1.2)

- **Admin-Only Routes & Id Invariance**:
  The five admin-only routes are:
  1. `POST /api/posts/[id]/publish`
  2. `POST /api/posts/[id]/unpublish`
  3. `POST /api/posts/[id]/revision/publish`
  4. `DELETE /api/posts/[id]/revision`
  5. `POST /api/posts/[id]/archive`
  
  On all five admin-only routes, the admin role check runs before any database read or lookup.
  Therefore, **admin-only routes return the same 403 `forbidden` for real and fake IDs alike** (with identical body `{ "error": "Forbidden.", "code": "forbidden" }`), leaving `BlogPost` unchanged.
- **Anonymous (No Session) on Admin Routes**:
  Anonymous requests (no session) to admin-only routes return HTTP status `401` (error code is unspecified in v1.2).
- **PATCH `force` Parameter**:
  The `force` parameter on `PATCH /api/posts/[id]` is restricted to admins. Any non-admin attempting `force` on `PATCH` receives `403` with code `forbidden`.
- **Error Response Format**:
  All errors follow the shape `{ error: string, code: string }`.

---

## 2. Authorization Matrix by Route & Method

| Method | Route / Path | Who (v1.2 Contract) | Anonymous Status | Anonymous Error Code | Guest Status | Guest Error Code | Admin Status | Admin Error Code |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/posts/[id]` | any (guest: own posts) | unspecified in v1.2 | unspecified in v1.2 | `200` (own post)<br>*(other's post / fake ID: unspecified in v1.2)* | None (success)<br>*(other's post / fake ID: unspecified in v1.2)* | `200`<br>*(fake ID: unspecified in v1.2)* | None (success)<br>*(fake ID: unspecified in v1.2)* |
| `PATCH` | `/api/posts/[id]` | any (guest: own posts) | unspecified in v1.2 | unspecified in v1.2 | `200` (own post without `force`)<br>`403` (if guest passes `force`)<br>*(other's post / fake ID / stale version: unspecified in v1.2)* | None (success)<br>`forbidden` (with `force`)<br>*(other's post / fake ID / stale version: unspecified in v1.2)* | `200`<br>*(fake ID / stale version: unspecified in v1.2)* | None (success)<br>*(fake ID / stale version: unspecified in v1.2)* |
| `GET` | `/api/posts/[id]/revision` | any (guest: own posts) | unspecified in v1.2 | unspecified in v1.2 | `200` (own post)<br>*(other's post / fake ID / missing revision: unspecified in v1.2)* | None (success)<br>*(other's post / fake ID / missing revision: unspecified in v1.2)* | `200`<br>*(fake ID / missing revision: unspecified in v1.2)* | None (success)<br>*(fake ID / missing revision: unspecified in v1.2)* |
| `DELETE` | `/api/posts/[id]/revision` | admin | `401` | unspecified in v1.2 | `403` (same for real & fake ID) | `forbidden` | `200` (success)<br>*(stale version / fake ID: unspecified in v1.2)* | None (success)<br>*(stale version / fake ID: unspecified in v1.2)* |
| `POST` | `/api/posts/[id]/publish` | admin | `401` | unspecified in v1.2 | `403` (same for real & fake ID) | `forbidden` | `200` (draft success)<br>`409` (not draft)<br>`409` (archived)<br>*(fake ID / stale version: unspecified in v1.2)* | None (success)<br>`not_draft`<br>`archived`<br>*(fake ID / stale version: unspecified in v1.2)* |
| `POST` | `/api/posts/[id]/revision/publish` | admin | `401` | unspecified in v1.2 | `403` (same for real & fake ID) | `forbidden` | `200` (success)<br>`409` (not published)<br>`409` (revision stale: RowVersion or BaseVersion mismatch)<br>`409` (archived, even with force)<br>`409` (slug taken)<br>*(fake ID: unspecified in v1.2)* | None (success)<br>`not_published`<br>`revision_stale`<br>`archived`<br>`slug_taken`<br>*(fake ID: unspecified in v1.2)* |
| `POST` | `/api/posts/[id]/unpublish` | admin | `401` | unspecified in v1.2 | `403` (same for real & fake ID) | `forbidden` | `200` (success)<br>`409` (not published)<br>*(fake ID / stale version: unspecified in v1.2)* | None (success)<br>`not_published`<br>*(fake ID / stale version: unspecified in v1.2)* |
| `POST` | `/api/posts/[id]/archive` | admin | `401` | unspecified in v1.2 | `403` (same for real & fake ID) | `forbidden` | `200` (success)<br>*(fake ID / stale version: unspecified in v1.2)* | None (success)<br>*(fake ID / stale version: unspecified in v1.2)* |
| `DELETE` | `/api/posts/[id]` | removed in v1.2 (use `/archive`) | unspecified in v1.2 | unspecified in v1.2 | unspecified in v1.2 | unspecified in v1.2 | unspecified in v1.2 | unspecified in v1.2 |

*Note on admin-only routes*: All 5 admin-only endpoints (`DELETE /api/posts/[id]/revision`, `POST /api/posts/[id]/publish`, `POST /api/posts/[id]/revision/publish`, `POST /api/posts/[id]/unpublish`, `POST /api/posts/[id]/archive`) check the role prior to any database read, ensuring a guest receives the exact same 403 `forbidden` status and body whether the ID exists (real) or does not exist (fake).

---

## 3. ADR-0004 Gate Tests Mapping (Gate Tests 1–12)

Each gate test from ADR-0004 is mapped below to the route(s) it exercises and the corresponding test file under `tests/security/*.test.ts`. Where no test file currently exists in `tests/security/`, it is marked `'to write'`.

| Gate Test # | ADR-0004 Gate Test Description | Route(s) Exercised | Test File (`tests/security/*.test.ts`) |
|---|---|---|---|
| **1** | A guest receives 403 `forbidden` on all five routes, and `BlogPost` is unchanged. No session receives 401. | `POST /api/posts/[id]/publish`<br>`POST /api/posts/[id]/unpublish`<br>`POST /api/posts/[id]/revision/publish`<br>`DELETE /api/posts/[id]/revision`<br>`POST /api/posts/[id]/archive` | 'to write' |
| **2** | Publish on a draft with null `PublishedAt` sets `published` and `PublishedAt`. Unpublish, then publish again, leaves that `PublishedAt` and returns the post to `published`. | `POST /api/posts/[id]/publish`<br>`POST /api/posts/[id]/unpublish` | 'to write' |
| **3** | Unpublish sets `draft` and keeps `PublishedAt`. | `POST /api/posts/[id]/unpublish` | 'to write' |
| **4** | Revision publish copies the pending fields onto `BlogPost` and marks the revision published, in one transaction. A `version` other than the revision `RowVersion` returns 409 `revision_stale` with both rows unchanged. | `POST /api/posts/[id]/revision/publish` | 'to write' |
| **5** | Publish and revision publish store `sanitizeHtml(bodyHtml)`. An injected `<script>` or `onerror` is absent from the live HTML. | `POST /api/posts/[id]/publish`<br>`POST /api/posts/[id]/revision/publish` | 'to write' |
| **6** | Discard sets `State` to `'discarded'` and leaves `BlogPost` byte-identical. | `DELETE /api/posts/[id]/revision` | 'to write' |
| **7** | Archive reserves the slug, omits the post from the public API, and a later publish returns 409 `archived`. | `POST /api/posts/[id]/archive`<br>`POST /api/posts/[id]/publish` (or `/revision/publish`) | 'to write' |
| **8** | The webhook is enqueued only after commit, for publish, revision publish, unpublish, and archive, with slice 3 events `publish`, `unpublish`, and `delete`. A webhook error leaves the committed row. Discard, draft save, and revision edit do not enqueue. | `POST /api/posts/[id]/publish`<br>`POST /api/posts/[id]/revision/publish`<br>`POST /api/posts/[id]/unpublish`<br>`POST /api/posts/[id]/archive`<br>`DELETE /api/posts/[id]/revision`<br>`PATCH /api/posts/[id]` | 'to write' |
| **9** | A revision publish that changes the slug writes the new slug and stores no redirect from the old slug. | `POST /api/posts/[id]/revision/publish` | 'to write' |
| **10** | On all five routes the admin role check runs before any DB read. A guest receives 403 `forbidden` for a real id and for a fake id, with the same body, and `BlogPost` is unchanged. | `POST /api/posts/[id]/publish`<br>`POST /api/posts/[id]/unpublish`<br>`POST /api/posts/[id]/revision/publish`<br>`DELETE /api/posts/[id]/revision`<br>`POST /api/posts/[id]/archive` | 'to write' |
| **11** | Unpublish and archive each mark any pending revision `State = 'discarded'` in the same transaction as the `BlogPost` write. The revision row and its content stay. The UI wording is "sets aside". | `POST /api/posts/[id]/unpublish`<br>`POST /api/posts/[id]/archive` | 'to write' |
| **12** | Revision publish returns 409 `revision_stale` and writes nothing when the revision `BaseVersion` does not equal the live `BlogPost.RowVersion`. An admin `force: true` overrides that `revision_stale` only when the post is currently `published`. Publish of an archived post returns 409 `archived` even with `force`. | `POST /api/posts/[id]/revision/publish` | 'to write' |

---

## 4. Error Code Reference (Contract v1.2 & ADR-0004)

| Status | Code | Condition / When | Source |
|---|---|---|---|
| 401 | unspecified in v1.2 | Request without session on admin-only endpoints (`requireAdmin`) | ADR-0004 §Context / Gate test 1 |
| 403 | `forbidden` | Non-admin on any admin-only endpoint, or non-admin passing `force` on `PATCH` | Contract v1.2 / ADR-0004 Gate tests 1, 10 |
| 409 | `not_draft` | `POST /api/posts/[id]/publish` on a post that is not a draft | Contract v1.2 |
| 409 | `not_published` | `POST /api/posts/[id]/unpublish` or `POST /api/posts/[id]/revision/publish` on a post that is not published | Contract v1.2 |
| 409 | `slug_taken` | `POST /api/posts/[id]/revision/publish` when another post took the revision's slug | Contract v1.2 |
| 409 | `revision_stale` | `POST /api/posts/[id]/revision/publish` when request version != revision RowVersion, or when revision BaseVersion != live BlogPost.RowVersion (without admin `force: true` on a published post) | Contract v1.2 / ADR-0004 §Decision 3 / Gate tests 4, 12 |
| 409 | `archived` | `POST /api/posts/[id]/publish` or `POST /api/posts/[id]/revision/publish` on an archived post (even with `force`) | Contract v1.2 / ADR-0004 §Decision 1, 3 / Gate tests 7, 12 |
