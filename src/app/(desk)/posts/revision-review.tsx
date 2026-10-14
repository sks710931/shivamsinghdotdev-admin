"use client";

import { normalizeEditorHtml } from "@/lib/editor-html";
import { formatIstDateTime } from "@/lib/format-ist";
import type { UserRole } from "@/lib/directory";
import type { PostStatus } from "@/lib/posts-client";

export function RevisionReview({
  role,
  status,
  liveTitle,
  liveSummary,
  liveHtml,
  pendingTitle,
  pendingSummary,
  pendingHtml,
  pendingAuthor,
  pendingUpdatedAt,
  liveChangedSinceBase,
  busy,
  onPublish,
  onDiscard,
}: {
  role: UserRole;
  status: PostStatus;
  liveTitle: string;
  liveSummary: string;
  liveHtml: string;
  pendingTitle: string;
  pendingSummary: string;
  pendingHtml: string;
  pendingAuthor: string;
  pendingUpdatedAt: string;
  liveChangedSinceBase: boolean;
  busy: boolean;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  if (role !== "admin") {
    return null;
  }

  const updated = formatIstDateTime(pendingUpdatedAt);

  return (
    <section aria-label="Pending review" className="rounded-2xl border border-line bg-panel p-5 shadow-sm shadow-black/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-paper">Pending review</h3>
          <p className="mt-1 text-xs text-mist">
            {pendingAuthor}
            {updated ? ` · ${updated}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === "archived" ? (
            <p className="text-sm text-mist">Archived posts cannot be published.</p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onPublish}
              className="inline-flex h-10 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-ink disabled:opacity-50"
            >
              Publish revision
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="inline-flex h-10 items-center rounded-lg border border-danger/40 px-3 text-sm text-danger disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      </div>
      {liveChangedSinceBase ? (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          The live post changed after this revision started. Confirm before you overwrite it.
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-ink p-4">
          <h4 className="text-xs font-medium tracking-wide text-mist uppercase">Live</h4>
          <p className="mt-2 font-display text-lg text-paper">{liveTitle}</p>
          {liveSummary ? <p className="mt-1 text-sm text-mist">{liveSummary}</p> : null}
          <div
            className="blog-preview-body mt-3 text-sm text-paper"
            dangerouslySetInnerHTML={{ __html: normalizeEditorHtml(liveHtml) }}
          />
        </article>
        <article className="rounded-xl border border-line bg-ink p-4">
          <h4 className="text-xs font-medium tracking-wide text-mist uppercase">Pending</h4>
          <p className="mt-2 font-display text-lg text-paper">{pendingTitle}</p>
          {pendingSummary ? <p className="mt-1 text-sm text-mist">{pendingSummary}</p> : null}
          <div
            className="blog-preview-body mt-3 text-sm text-paper"
            dangerouslySetInnerHTML={{ __html: normalizeEditorHtml(pendingHtml) }}
          />
        </article>
      </div>
    </section>
  );
}
