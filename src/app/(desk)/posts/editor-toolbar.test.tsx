import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { defaultToolbar, EditorToolbar } from "./editor-toolbar";

describe("EditorToolbar", () => {
  it("exposes pressed states, synced block type, and distinct code controls", () => {
    render(
      <EditorToolbar
        snapshot={{ ...defaultToolbar, block: "h3", bold: true, mark: true, inlineCode: false, codeBlock: true }}
        onCommand={vi.fn()}
        onBlock={vi.fn()}
        onFormat={vi.fn()}
        onTask={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Paragraph type" })).toHaveProperty("value", "h3");
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Highlight" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Inline code" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Code block" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Underline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Subscript" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Superscript" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Align left" })).toBeNull();
  });
});
