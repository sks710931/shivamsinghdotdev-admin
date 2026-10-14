# ADR-0005: Public site consumption of the admin public API

## Context

The public site (`shivamsinghdotdev`, Next.js) must render the blog from the admin public API. Slice 3 adds read routes and on-demand revalidation. The site must stay a consumer: it never opens a database connection, and HTML is trusted only after the admin write-time sanitizer plus the existing CSP.

## Facts

- Repo `shivamsinghdotdev` (Next.js) has no blog routes, no DB client, and no article styles.
- CSP is applied per request with a nonce in `proxy.ts`.
- The read contract is `docs/contracts/slice3-public-api.md`: `GET /api/public/posts` and `GET /api/public/posts/[slug]`.
- Base URL comes from `ADMIN_PUBLIC_API_URL`.

## Decision

Add `/blog` (index, paged) and `/blog/[slug]` as server components in the public site.

Fetch from `ADMIN_PUBLIC_API_URL`:

- list: `/api/public/posts`, `next: { revalidate: 300 }`, tag `posts`
- post: `/api/public/posts/[slug]`, `next: { revalidate: 300 }`, tags `post:<slug>` and `posts`

A `404` from the post endpoint calls `notFound()`. `generateMetadata` uses `seoTitle`, `summary`, and `tags`, and sets a canonical URL. Dates render in `Asia/Kolkata`.

Render `bodyHtml` with `dangerouslySetInnerHTML` inside an `.article` wrapper. Trust boundary:

- Sanitized on write in admin (`sanitize-html` allow-list): no `script`, no `on*` attributes, no `style` attribute, no iframes except the allow-list.
- CSP keeps `script-src` nonce-only, so a surviving inline script does not execute (defence in depth).
- Images load only from allow-listed hosts via `img-src`.

`POST /api/revalidate` verifies HMAC before calling `revalidateTag`:

- Headers: `X-Timestamp`, `X-Signature`.
- Secret: `REVALIDATE_SECRET`.
- Window: 300 seconds.
- Compare with `timingSafeEqual`.

The public site never connects to the DB.

Build must succeed when the admin API is down. The list renders an empty state. Slug pages are on-demand ISR. Slice 3 does not call `generateStaticParams`.

## Consequences

- Freshness is at most 300 seconds without a webhook; a valid revalidate call drops the tagged cache immediately.
- A bad or missing signature returns `401` and does not purge cache.
- Unpublished or missing slugs 404 after the revalidate window even if no webhook arrives.
- Article CSS is new work in the public site. The admin remains the only writer and the only sanitizer.
- Nonce-only `script-src` stays mandatory on blog routes. Relaxing it would remove the second control on `bodyHtml`.

## Open questions

- Redirects from old slugs after a rename.
- Sitemap and RSS. Deferred to slice 4.

## Gate tests

- CSP header is present on `/blog/[slug]`.
- An injected `<script>` in `bodyHtml` does not execute.
- An unpublished post returns 404 within 300 seconds without a webhook.
- A bad signature on `POST /api/revalidate` returns `401`.
