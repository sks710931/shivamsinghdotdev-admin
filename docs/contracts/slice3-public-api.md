# Slice 3 contract: read-only public API

Status: contract for slice 3. Implements [ADR-0001](../decisions/ADR-0001-public-content-boundary.md).

The admin app serves the two GETs. They require no session and return only the live published row (not archived). The public site serves `POST /api/public/revalidate`. Public pages use ISR `revalidate = 300` as a fallback, so an unpublished or archived post disappears within 5 minutes even if the webhook is lost. Pending `PostRevision` rows stay invisible. Archive is public `delete`: the slug stays reserved in the admin app and is not found here.

## Shared

JSON only. Every error is `{ "error": string, "code": string }` with `Cache-Control: no-store`.

| Status | code | When |
|---|---|---|
| 400 | `bad_request` | Bad `page` / `pageSize`, or a webhook body that is not the shape below |
| 401 | `unauthorized` | Webhook signature missing or wrong, `|now - timestamp| > 300` seconds, or `REVALIDATE_SECRET` unset |
| 404 | `not_found` | Draft, archived, or unknown slug (one body for all three) |
| 429 | `rate_limited` | Over 60 requests in the current 60-second window for that IP |

Rate limit applies to all three routes, checked first. The 61st request gets `429` `{ "error": "Too many requests.", "code": "rate_limited" }` and `Retry-After` (seconds left in the window). IP is the admin app's existing client address. `X-Forwarded-For` spoofing stays the known audit S4 limit and is not an auth boundary.

`authorName` is trimmed `AdminUser.DisplayName`, or `""` when that is null or blank. It is never an email. Dates are ISO 8601 UTC. `tags` and `seoKeywords` are `string[]`: split the stored comma string on `,`, trim, drop empties.

`bodyHtml` is served exactly as stored (sanitised on write). The list omits `bodyHtml`.

A response contains only the fields listed for that route. That set excludes `AuthorId`, `RowVersion`, email, role, status, and every `PostRevision` field (id, body, timestamps). A version-semantics note is not needed.

## GET /api/public/posts

Published, non-archived posts. Sort is fixed: `publishedAt` descending. The list omits `bodyHtml`.

Query: `page` (integer ≥ 1, default 1), `pageSize` (integer 1–50, default 20). Any other value is `400`. A page past the end is `200` with `posts: []`.

`200` body, each item exactly these fields:

```json
{ "posts": [{ "id": "", "slug": "", "title": "", "summary": "", "tags": [], "publishedAt": "", "authorName": "" }], "page": 1, "pageSize": 20, "total": 0 }
```

`Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`. Do not `Vary` on `Cookie`.

## GET /api/public/posts/[slug]

Exact slug. `200` is the seven list fields plus `bodyHtml` (served exactly as stored; sanitised on write), `seoTitle`, `seoKeywords`, and `updatedAt`. Same cache header.

Draft, archived, and unknown slugs each return `404` `{ "error": "Not found.", "code": "not_found" }`.

## POST /api/public/revalidate

Public site. The admin app calls it after a committed publish, unpublish, or delete (archive), and only then. Draft save, autosave, and revision edit do not call it. A failed call does not roll back the write. Public pages use ISR `revalidate = 300` as a fallback, so an unpublished or archived post disappears within 5 minutes even if the webhook is lost.

Raw UTF-8 body, keys in this order and no others. `event` is `publish`, `unpublish`, or `delete`.

```json
{ "slug": "my-post", "event": "publish" }
```

Signature is `HMAC-SHA256(REVALIDATE_SECRET, timestamp + '.' + rawBody)`. `X-Timestamp` is that timestamp as unix seconds. `X-Signature` is the signature as hex. `REVALIDATE_SECRET` must be unique and must not be reused. Both apps share that one value.

Reject `401` `{ "error": "Invalid signature.", "code": "unauthorized" }` when `|now - timestamp| > 300` seconds or the signature does not match. Compare with `crypto.timingSafeEqual` on equal-length buffers. A different length is a mismatch and must not call `crypto.timingSafeEqual`. Do not revalidate on `401`. Success is `204` with no body and `Cache-Control: no-store`, and revalidates the slug page and the list page.

## Gate tests

1. List and detail return only published posts. Draft and archived slugs match the unknown-slug `404` body and stay off the list.
2. A pending revision leaves list and detail unchanged. `bodyHtml` is served exactly as stored (sanitised on write).
3. List objects have exactly the seven fields, `publishedAt` descending. Detail adds only `bodyHtml`, `seoTitle`, `seoKeywords`, `updatedAt`.
4. `pageSize` 50 succeeds. `51`, `0`, and non-integers are `400` `bad_request`. A page past the end is an empty `200`.
5. Bodies omit `AuthorId`, `RowVersion`, email, and revision fields. A blank display name yields `authorName: ""`.
6. A session cookie does not change the payload. Successful GETs send the cache header above and do not vary on `Cookie`. Errors are `no-store`.
7. A correct `HMAC-SHA256(REVALIDATE_SECRET, timestamp + '.' + rawBody)`, with `X-Timestamp` (unix seconds) and `X-Signature` (hex), returns `204` and revalidates. A missing or wrong signature returns `401` and does not revalidate.
8. The admin app calls the webhook only after publish, unpublish, and delete. Autosave and revision save do not. Webhook failure leaves the live row committed.
9. Request 61 inside one 60-second window from one IP is `429` `rate_limited` on each route, including a bad signature.
10. Every error body is `{error, code}` using only the codes in the table above.
11. A replayed request older than 300 seconds returns `401` and does not revalidate.
12. A dropped webhook still yields `404` for an unpublished post within 300 seconds.
13. A tampered body returns `401` and does not revalidate.
