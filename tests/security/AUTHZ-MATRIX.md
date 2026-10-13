# Slice 1 authorization matrix (contract v1.1). Expected status per role.
| Endpoint | Anonymous | Guest, own post | Guest, other's post | Admin |
|---|---|---|---|---|
| GET /api/posts | 401 | 200, own posts only | not listed | 200, all |
| GET /api/posts/[id] | 401 | 200 | 404 | 200 |
| PATCH /api/posts/[id] (draft) | 401 | 200, live | 404 | 200, live |
| PATCH /api/posts/[id] (published) | 401 | 200, pendingRevision, live row byte-identical | 404 | 200, pendingRevision |
| PATCH with Status/AuthorId/PublishedAt | 401 | fields ignored or 400 | 404 | fields ignored or 400 |
| PATCH stale version | 401 | 409 stale_version | 404 | 409 stale_version |
| GET/DELETE /api/posts/[id]/revision | 401 | 200 (own revision) | 404 | 200 |
| POST /publish, /unpublish | 401 | 403 | 404 | 200 / 409 revision_stale / 409 archived |
| DELETE /api/posts/[id] (archive) | 401 | 403 | 404 | 200 |
| Cross-origin mutation (bad Origin) | 403 | 403 | 403 | 403 |
