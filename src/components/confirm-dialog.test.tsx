import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/confirm-dialog";

function Harness({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open archive
      </button>
      <ConfirmDialog
        open={open}
        title="Archive this post?"
        description="The URL slug stays reserved."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={onConfirm}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("traps a modal dialog and closes on Escape, returning focus", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);

    const opener = screen.getByRole("button", { name: "Open archive" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Archive this post?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("The URL slug stays reserved.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Archive" }));
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("confirms from the action button", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Publish this post?"
        description="It will go live."
        confirmLabel="Publish"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
