import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DraftRecoveryBanner } from "@/components/draft-recovery-banner";
import { formatIstDateTime } from "@/lib/format-ist";

const savedAt = "2026-10-13T08:35:00.000Z";

describe("DraftRecoveryBanner", () => {
  it("announces unsaved changes with the IST timestamp", () => {
    render(<DraftRecoveryBanner savedAt={savedAt} onRestore={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toBe(`Unsaved changes from ${formatIstDateTime(savedAt)}`);
    expect(screen.getByRole("status").textContent).toBe("Unsaved changes from 13 Oct 2026, 14:05 IST");
  });

  it("restores and discards from focusable buttons", () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(<DraftRecoveryBanner savedAt={savedAt} onRestore={onRestore} onDiscard={onDiscard} />);

    const restore = screen.getByRole("button", { name: "Restore" });
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(restore.getAttribute("type")).toBe("button");
    expect(discard.getAttribute("type")).toBe("button");
    expect(restore.tabIndex).toBe(0);
    expect(discard.tabIndex).toBe(0);

    restore.focus();
    expect(document.activeElement).toBe(restore);
    fireEvent.click(restore);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    discard.focus();
    expect(document.activeElement).toBe(discard);
    fireEvent.click(discard);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("keeps a status when the timestamp cannot be formatted", () => {
    render(<DraftRecoveryBanner savedAt="not-a-date" onRestore={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toBe("Unsaved changes");
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });
});
