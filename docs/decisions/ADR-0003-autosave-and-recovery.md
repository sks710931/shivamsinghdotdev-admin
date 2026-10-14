# ADR-0003: Autosave and unsaved-work recovery (slice 2)

Status: Proposed (14 Oct 2026). Owner: NEXUS. Reviewers: PIXEL, FORGE, SENTINEL, PULSE.

## Problem
Work can be lost when a tab crashes, the network drops, a session expires after 12 hours, or two tabs edit the same post.

## Decision
Two layers, with no new infrastructure:
1. **Local snapshot (PIXEL, already in progress on `feat/editor-local-recovery`).** A debounced snapshot is keyed by `postId` (or `new:<uuid>`), the user id and `baseVersion`. The editor offers Restore/Discard on load when a snapshot is newer than the server copy, and clears the snapshot after a successful save, publish or discard. It is never sent anywhere automatically. Snapshots are cleared on sign-out because the computer may be shared.
2. **Server autosave.** The editor uses the existing `PATCH /api/posts/[id]` with `version`, debounced (about 5 s after the last keystroke, and at most once every 30 s while typing), plus a save on blur and on `visibilitychange` to hidden. Under ADR-0002, an autosave on a published post only ever updates the pending revision, so nothing reaches the public site.
   - A new post becomes a draft on its first autosave (`POST /api/posts` returns `id` and `version`), and later saves are `PATCH`.
   - **Stale version (`409 stale_version`):** autosave stops. The banner reads "Changed elsewhere" and offers Reload or Keep mine, where Keep mine re-sends with the current version. Edits are never merged silently.
   - **Session expired (401):** autosave pauses, and the local snapshot keeps the work. After sign-in, the editor offers Restore.
   - **Network or 5xx:** retry with backoff (2 s, 5 s, 15 s, then every 60 s). The status shows "Saved", "Saving…", "Offline, saved locally" or "Not saved". Retrying is safe because each `PATCH` carries `version`, so a duplicate gets a 409 instead of a double write.
3. **No new endpoints are required.** `PATCH` must accept a body with no changes as a no-op that returns the same `version`, so autosave can't increase versions when nothing changed (FORGE).

## Rejected
- Server-side autosave history or a revision log: that's slice 5 and later if the Founder wants it.
- WebSockets or collaborative editing: there is one author per post, so they aren't needed.
- Autosaving published posts straight to live: ADR-0002 forbids it.

## Sanitiser interaction
Autosave goes through the same `sanitizeHtml` on every `PATCH`. The editor reloads the HTML the server returns only on an explicit reload, never in the middle of typing, so the cursor doesn't jump.

## Tests (SENTINEL gate)
- A crash or reload restores the snapshot.
- A second tab's save makes the first tab show the 409 banner, and nothing is overwritten.
- An expired session keeps the work locally.
- Autosave on a published post leaves the live row byte-identical.
- An unchanged body does not bump `version`.

## Revisit when
A post needs more than one concurrent author, or the Founder asks for a full revision history.
