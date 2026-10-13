# Phase 0 Project Audit — shivamsinghdotdev-admin

- **Baseline:** `main` @ `0f5e828` (main HEAD confirmed unchanged at time of writing, 13 Oct 2026). Public site `shivamsinghdotdev` @ `7703267`.
- **Record keeper:** Atlas. **Sources:** `PULSE-phase0.md`, `SENTINEL-phase0.md`, `PIXEL-phase0.md`, `FORGE-phase0.md`, `FORGE-slice1-contract.md`, `NEXUS-phase0.md`.
- **Method:** static code reading. **V** = verified by code read (Atlas spot-checked the key lines marked ✔). **I** = inferred / unverified. Only Pulse executed anything (install, lint, `next build`, `tsc` on the shared box). **Nobody ran the app against a database or in a browser.**
- Paths are relative to `src/` unless they start with `.github/` or `next.config.ts`.

## 1. Current functionality
| Area | State | Ref | Tag | Owner |
|---|---|---|---|---|
| Auth: login/logout/session, invite acceptance | Works (code) | `server/auth.ts`, `app/api/auth/*` | V | Forge |
| User & invite management, admin-only | Works (code) | `app/api/users/route.ts:9`, `users/[id]/route.ts:21,37` | V | Forge |
| Posts: list + create only | Works (code) | `app/api/posts/route.ts:26,36` | V ✔ | Forge |
| TinyMCE 8 editor (self-hosted), preview dialog | Create-only | `app/(desk)/posts/post-editor.tsx` | V | Pixel |
| App shell: mobile drawer, `aria-current`, Escape | Solid | `components/app-shell.tsx` | V | Pixel |
| Build: install, lint, `next build` pass (15 routes) | Executed on box | — | V (run) | Pulse |
| Public site: home, sitemap, robots; **no blog** | — | `shivamsinghdotdev` @ 7703267 | V | Nexus |

## 2. Missing functionality
- No GET-by-id / update / delete / publish / unpublish for posts — `api/posts/route.ts` (V, Forge).
- Post list is a dead end: rows not links, no search/filter/sort/pagination — `(desk)/posts/page.tsx:53-62` (V, Pixel).
- Editor is create-only: no props, hard-wired `POST /api/posts` — `post-editor.tsx:169`, `:291` (V, Pixel).
- No autosave, local recovery, or unsaved-changes guard; "Last edited"/"Visibility" hard-coded — `post-editor.tsx:586`, `:598` (V, Pixel/Sentinel).
- Images URL-only; no upload handler, alt-text enforcement, or media library — `post-editor.tsx:451` (V, Pixel/Forge).
- No revision, media or autosave tables (V, Forge). No tests of any kind (V, Sentinel/Pixel). No CI quality gates (V, Pulse).
- Public site has no blog routes, data client, or article styles (V, Nexus).

## 3. Technical debt
- Runtime DDL: `AdminUser`/`AdminSession`/`UserInvite` created at request time, columns added by ad-hoc `ALTER` — `server/auth.ts:93-154`, `:125-133` (V ✔, Forge). App DB login needs DDL rights (least privilege).
- `BlogPost` created at runtime, `ensurePostSchema` **not memoized** → extra DDL round trip on every list/create — `server/posts.ts:45`, `:71`, `:106` (V ✔, Forge).
- First admin seeded from `ADMIN_*` inside schema bootstrap — `server/auth.ts:156-182` (V, Forge).
- `BlogPost` lacks `RowVersion`, `PublishedAt`, archived state, `CHECK` on Status; no `CHECK` on `AdminUser.Role`; no `(Status, PublishedAt)` index; tags/SEO keywords as comma strings (V, Forge).
- `UpdatedAt` never maintained; `listPosts` unpaginated; body cap 200k chars (V, Forge — notes).
- Standalone `tsc --noEmit` fails on clean checkout (Next-generated `LayoutProps`); CI must run `next typegen`/build first (V run, Pulse).
- Editor UX: identical `Code` icons (`:415`, `:445`), block select never syncs (`:389`), no active states, slash menu not keyboard-usable, Publish panel drops below article under 1280px (`:321`) (V, Pixel).

## 4. Confirmed defects (code-read, not reproduced)
| ID | Defect | Ref | Tag | Owner |
|---|---|---|---|---|
| D1 | Deleting a user who authored posts → FK error (547) → generic 500; `FK_BlogPost_Author` has no delete rule | `server/users.ts:278` | V ✔ (line), I (runtime) | Forge |
| D2 | Last-admin check not atomic with UPDATE/DELETE (no transaction) | `server/users.ts` `assertCanChange` | V | Forge |
| D3 | Status dropdown + single "Save post" publishes without confirm | `post-editor.tsx:359-367`, `:565` | V | Pixel |
| D4 | Save navigates away (`router.push("/posts")`) | `post-editor.tsx:301` | V | Pixel |
| D5 | Preview uses hard-coded colours, not public article styles | `post-editor.tsx:670-711`, `globals.css:137+` | V | Pixel |

## 5. Security findings
| ID | Pri | Finding | Ref | Tag | Owner |
|---|---|---|---|---|---|
| S1 | **P1** | Guests can create **and publish** posts: `requireUser` not admin check; status taken from body | `app/api/posts/route.ts:36`; `server/posts.ts:104` | V ✔ | Forge (fix), Sentinel (test) |
| S2 | **P1** (release gate) | HTML stored unsanitised (`posts.ts:103`); preview strips only `<script>` via regex then `dangerouslySetInnerHTML` (`post-editor.tsx:93`, `:707`). `onerror`/`onload`/`javascript:` survive. Becomes stored XSS against admins reviewing guest revisions | as cited | V ✔ (code), payloads not executed | Forge + Sentinel |
| S3 | **P1** (data loss) | No autosave/recovery/navigation guard; 12h session TTL | `post-editor.tsx`, `server/auth.ts` SESSION_TTL | V | Pixel + Forge (slice 2) |
| S4 | P2 | Login lockout in memory (`auth.ts:33`), keyed on first `X-Forwarded-For` (`http.ts:25-27`); per-IP only | as cited | V ✔ (code); spoofability on Azure **I** | Forge/Sentinel |
| S5 | P2 | No Content-Security-Policy in `next.config.ts` | `next.config.ts` | V ✔ | Pulse/Sentinel |
| S6 | P3 | `assertSameOrigin` trusts `x-forwarded-host` | `server/http.ts:7` | V | Sentinel |
| U1 | — | Runtime DDL + seeding race on cold multi-instance start | `server/auth.ts:93-183` | I | Forge |
| U4 | — | `proxy.ts` only checks cookie exists and excludes `/api`; every route must self-check auth | `proxy.ts` | V | Sentinel (test) |

**Positive controls (V):** parameterised SQL; scrypt + `timingSafeEqual` + dummy hash; 32-byte session tokens stored as SHA-256; httpOnly SameSite=Lax cookie; invite acceptance transactional with UPDLOCK; all user-management routes admin-only; same-origin check on mutations.

## 6. Deployment findings (Owner: Pulse)
- Only workflow is SWA deploy; PRs get deploy previews with no lint/type/test checks (V).
- `api_location: "api"` is wrong for Next.js hybrid on SWA; should be `""` — `.github/workflows/*.yml:32` (V ✔).
- `actions/checkout@v3` outdated (`:18`, V ✔); no Node version pinned (CI used 22, box 20) (V).
- Run 37349047434: build OK, then "Web app warm up timed out" (V from logs). Most likely cause: warm-up hits `/`, which needs `DATABASE_URL`/`ADMIN_*`, **confirmed by the Founder as not set in Azure**. Runtime DDL on cold start and SWA hybrid-Next preview limits are secondary candidates (I).

## 7. Reuse opportunities
- Keep existing auth/session/invite machinery and `server/*` modules — solid baseline (Sentinel, Nexus).
- Keep TinyMCE 8: covers headings, tables, codesample+Prism, `images_upload_handler`, inline mode (Pixel; I — not load-tested on very long articles).
- Public site already uses a CSP nonce — reuse its pattern for admin CSP (Nexus).
- Reuse `assertSameOrigin` + JSON content-type check for all new mutations; app shell for new pages.

## 8. Architectural recommendations
- **ADR-0001 (proposed, Nexus): publishing boundary.** Admin app is the only writer and schema owner. It exposes a read-only public API — `GET /api/public/posts`, `GET /api/public/posts/[slug]` — published rows only, already-sanitised HTML, cache headers. Public site renders with time-based **ISR** plus an on-demand revalidate webhook fired on publish/unpublish. Rejected: public site reading SQL directly (shared schema + DB credential); static export into the public repo (commit per publish, awkward unpublish). Revisit if a second consumer appears or public-API availability becomes a problem. Open: Sentinel to test stale-cache of unpublished posts when the webhook fails.
- **Shared article stylesheet:** one `article.css` scoped under `.article`, used by admin preview and public site. Owner: Pixel.
- **Media storage interface:** local disk in dev, Azure Blob in prod. **Azure Blob is a paid resource and needs Founder approval** before slice 4.
- Stay a modular monolith; no extra services. Publish-revision must be a single transaction with a `RowVersion` check on the live row (Nexus).
- Versioned SQL migrations replace runtime DDL (Forge, Pulse, Sentinel).

## 9. Decisions log
| # | Decision | Source |
|---|---|---|
| 1 | Keep the stack (Next.js 16, SQL Server) and TinyMCE | Team consensus |
| 2 | **Local-first; Azure parked** until the app runs end to end locally. `DATABASE_URL`/`ADMIN_*` are not set in Azure | **Founder confirmed** |
| 3 | **Guest rule:** guests create articles as guest author and view/edit only their own; admins see/edit all; only admins publish, unpublish, delete (archive). Other authors' posts return 404 to guests | **Founder confirmed** |
| 4 | Guest edits to published posts become a **pending revision** (`PostRevision` table); live row unchanged until an admin publishes | **Founder confirmed** |
| 5 | Server-side sanitiser (`sanitize-html`) on **every save, every role**. Allow-list: `p`, `h2`–`h4`, `strong`, `em`, `s`, `code`, `pre`, `blockquote`, `ul`/`ol`/`li`, `table` + children, `hr`, `br`, `a`, `img`, `figure`, `figcaption`, **`mark`**; `href` http/https/mailto with forced `rel="noopener noreferrer"`; `img` `src` (https or own media origin), `alt`, `width`, `height`; `class` only `language-*` (on **`pre` and `code`**) or `task-list`; **`input type=checkbox` only inside `ul.task-list > li`**, attrs `checked`/`disabled`, `disabled` forced. Strip all `on*`, `style`, `iframe`, `svg`, `form`, `object`, `embed`. Editor drops underline/sub/sup/alignment; highlight → `mark` | Sentinel + Pixel + Forge |
| 6 | Versioned migrations (`db/migrations/*.sql`, `SchemaVersion` table) via `pnpm db:migrate`, idempotent, run as explicit step; app stops running DDL | Forge + Pulse |
| 7 | Local env: one shared SQL Server 2022 container (2 GB cap), one database per agent, `pnpm dev:local`, random SA password in gitignored `.env.local` | Pulse, approved by Atlas |
| 8 | All coding via Grok Build CLI | Founder |
| 9 | PR order: this audit merges first; feature branches held locally until then | Atlas |

## 10. Prioritized slices
1. **Editing + roles + sanitiser + migrations**
   - Forge (`feat/posts-slice1-backend`): migrations baseline + 0002 (`RowVersion`, `PublishedAt`, archived + `CHECK`, `(Status, PublishedAt)` index), `PostRevision`, endpoints per `FORGE-slice1-contract.md` (GET list/by id, PATCH with `version`, revision GET/DELETE, publish, unpublish, archive DELETE), error shapes `400/403 forbidden/404 not_found/409 stale_version|slug_taken`, sanitiser.
   - Pixel: edit mode, linked list rows, Save draft / Publish (confirm) / Unpublish, guest "Submit for review" + live-unchanged banner, admin "Pending review" filter and side-by-side revision view, editor toolbar trimmed to the allow-list.
   - Sentinel: gates and tests below.
   - Pulse (`chore/local-env-ci`): `pnpm dev:local`, `.env.example`, PR checks workflow (lint, typegen+tsc, tests, build), fix `api_location`, checkout version, Node pin.
2. **Autosave + recovery** (server autosave, localStorage fallback, restore prompt, nav guard).
3. **Public read API + public blog pages** (ADR-0001, `.article` stylesheet, CSP).
4. **Media** (upload endpoint, storage interface; Azure Blob needs Founder approval).
5. **Polish** (toolbar, list search/sort, SEO panel, Desk home).

### Slice 1 acceptance criteria (Sentinel)
- Guest gets **404** reading or patching another author's post, and **403** on publish/unpublish/delete.
- Guest edit to a published post leaves the live `BlogPost` row **byte-identical** and creates/updates one pending `PostRevision`.
- Guest cannot set `Status`, `AuthorId`, `PublishedAt`, or the slug of a published post (allow-listed PATCH fields only).
- Stale `version` returns **409 `stale_version`**; slug collision returns **409 `slug_taken`**.
- XSS payload corpus is neutralised on both save and render.
- Authorization matrix (anonymous / guest / admin) covers every post and user route.
- Migrations are idempotent on an empty DB and on an existing DB.

## 11. Open items
1. Nexus/Sentinel: stale-cache behaviour for unpublished posts when the revalidate webhook fails.
2. Sentinel/Pulse: confirm whether Azure SWA overwrites or appends `X-Forwarded-For` (S4); choose trusted client-IP header.
3. Forge: D1 policy — block deletion with a message, or reassign posts.
4. Founder: approve Azure Blob cost before slice 4.
5. Founder (later, when Azure resumes): set `DATABASE_URL`/`ADMIN_*` in SWA app settings and check Azure SQL firewall allows Azure services.
6. Pulse: Docker is not a system service on the shared box; setup script must start it.
7. Pixel: confirm TinyMCE performance on very long articles (inferred only).
