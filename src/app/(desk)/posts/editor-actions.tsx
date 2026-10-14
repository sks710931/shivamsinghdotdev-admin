"use client";

import { Eye, Save } from "lucide-react";

import type { PostActionVisibility } from "@/lib/post-actions";

export const LIVE_UNCHANGED_BANNER = "Live version unchanged until an admin publishes your edits";

export function LiveUnchangedNotice() {
  return (
    <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-paper">{LIVE_UNCHANGED_BANNER}</p>
  );
}

export function EditorActions({
  layout,
  pending,
  savedLabel,
  actions,
  canArchive,
  canUpdate,
  onSave,
  saveDisabled = false,
  onPublish,
  onUpdate,
  onUnpublish,
  onArchive,
  onPreview,
}: {
  layout: "stack" | "bar";
  pending: boolean;
  savedLabel: string | null;
  actions: PostActionVisibility;
  canArchive: boolean;
  canUpdate: boolean;
  onSave: () => void;
  saveDisabled?: boolean;
  onPublish: () => void;
  onUpdate: () => void;
  onUnpublish: () => void;
  onArchive: () => void;
  onPreview: () => void;
}) {
  const stack = layout === "stack";
  const primary = stack
    ? "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-ink transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
    : "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-ink disabled:opacity-50";
  const secondary = stack
    ? "mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm text-paper transition-colors hover:border-paper/30 disabled:opacity-50"
    : "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm text-paper disabled:opacity-50";
  const danger = stack
    ? "mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-danger/40 text-sm text-danger disabled:opacity-50"
    : "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-danger/40 px-3 text-sm text-danger disabled:opacity-50";
  const saveLabel = actions.saveDraft ? "Save draft" : "Save";

  return (
    <div className={stack ? "flex flex-col" : "flex flex-wrap items-center justify-end gap-2"}>
      {savedLabel ? (
        <p role="status" className={stack ? "mb-3 text-sm text-accent" : "mr-auto text-xs text-accent"}>
          {savedLabel}
        </p>
      ) : null}
      {actions.save || actions.saveDraft ? (
        <button type="button" disabled={pending || saveDisabled} onClick={onSave} className={primary}>
          <Save aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          {pending ? "Saving" : saveLabel}
        </button>
      ) : null}
      {actions.publish ? (
        <button type="button" disabled={pending} onClick={onPublish} className={secondary}>
          Publish
        </button>
      ) : null}
      {canUpdate ? (
        <button type="button" disabled={pending} onClick={onUpdate} className={secondary}>
          Update live post
        </button>
      ) : null}
      {actions.unpublish ? (
        <button type="button" disabled={pending} onClick={onUnpublish} className={secondary}>
          Unpublish
        </button>
      ) : null}
      {canArchive ? (
        <button type="button" disabled={pending} onClick={onArchive} className={danger}>
          Archive
        </button>
      ) : null}
      <button type="button" onClick={onPreview} className={secondary}>
        <Eye aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        Preview
      </button>
    </div>
  );
}
