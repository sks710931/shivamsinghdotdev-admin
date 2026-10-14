"use client";

import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  pending = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) {
      return;
    }

    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
    preferred?.focus();

    return () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      }
      returnTo.current?.focus();
    };
  }, [open]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const active = document.activeElement;
    const index = nodes.indexOf(active instanceof HTMLElement ? active : first);
    if (event.shiftKey) {
      const previous = index <= 0 ? last : nodes[index - 1];
      previous?.focus();
      return;
    }
    const next = index < 0 || index >= nodes.length - 1 ? first : nodes[index + 1];
    next?.focus();
  }

  if (!open) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-panel p-0 text-paper backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div className="flex flex-col gap-4 p-5">
        <h3 id={titleId} className="font-display text-2xl leading-none text-paper">
          {title}
        </h3>
        <p id={descriptionId} className="text-sm leading-6 text-mist">
          {description}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm text-paper"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={
              tone === "danger"
                ? "inline-flex h-10 items-center rounded-lg bg-danger px-3 text-sm font-semibold text-ink disabled:opacity-50"
                : "inline-flex h-10 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-ink disabled:opacity-50"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
