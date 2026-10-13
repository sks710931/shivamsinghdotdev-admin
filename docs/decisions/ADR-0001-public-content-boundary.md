# ADR-0001: Public site reads posts through a read-only API in the admin app

Status: Accepted (13 Oct 2026). Owner: NEXUS.

## Context (verified)
- The admin app (this repo) owns the SQL schema and is the only writer.
- The public site (sks710931/shivamsinghdotdev @ 7703267) has no blog routes, DB client or article styles.

## Decision
- The admin app exposes `GET /api/public/posts` and `GET /api/public/posts/[slug]`. They need no auth, return published, non-archived posts only, serve the HTML that was sanitised on save, and set cache headers.
- The public site renders with time-based ISR and is revalidated on demand by a webhook that fires on publish, unpublish and archive.
- The admin app owns one article stylesheet, scoped under `.article`, which the preview and the public site share.

## Rejected
- The public site reading SQL directly: two apps would share the schema and a DB credential.
- Exporting static files into the public repo: every publish needs a commit, and unpublishing is slow.

## Open
- What happens to an unpublished post's cached page when the webhook fails. This is SENTINEL's gate for slice 3, and the ISR window bounds the staleness.

## Revisit when
A second consumer appears, or the public API's availability or latency hurts the public site.
