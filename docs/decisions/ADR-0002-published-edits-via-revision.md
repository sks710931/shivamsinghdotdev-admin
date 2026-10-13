# ADR-0002: Every edit to a published post goes to a pending revision

Status: Accepted (13 Oct 2026). Proposed by SENTINEL, accepted by FORGE, PIXEL, NEXUS and ATLAS. Business rule confirmed by the Founder.

## Decision
- `BlogPost` is the live row. `PostRevision` holds at most one pending edit per post.
- Every edit to a published post, by an admin or a guest, goes into the revision. Only Publish makes it live; for an admin this is a one-click "Update live post".
- Publish runs as one transaction that checks `RowVersion` and returns `409 stale_version`. When the live post changed after the revision was created, it returns `409 revision_stale` unless the request sends `force: true`.
- Archived posts reject publishing (`409 archived`), never appear publicly, and keep their slug reserved.

## Why
Autosave (slice 2) must never push partial text to the public site. It also leaves one code path instead of a branch for each role.

## Revisit when
Multiple concurrent pending revisions per post are needed.
