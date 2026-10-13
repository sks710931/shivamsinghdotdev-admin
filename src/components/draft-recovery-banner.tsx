"use client";

import { formatIstDateTime } from "@/lib/format-ist";

export function DraftRecoveryBanner({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const when = formatIstDateTime(savedAt);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
      <p role="status" className="text-sm text-paper">
        {when ? `Unsaved changes from ${when}` : "Unsaved changes"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex h-10 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-ink"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex h-10 items-center rounded-lg border border-danger/40 px-3 text-sm text-danger"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
