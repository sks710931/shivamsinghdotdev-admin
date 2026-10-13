import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getPostActions } from "@/lib/post-actions";
import type { UserRole } from "@/lib/directory";
import type { PostStatus } from "@/lib/posts-client";
import { EditorActions, LIVE_UNCHANGED_BANNER, LiveUnchangedNotice } from "./editor-actions";
import { RevisionReview } from "./revision-review";

function renderActions(role: UserRole, status: PostStatus, hasPending: boolean) {
  const actions = getPostActions(role, status, hasPending);
  return render(
    <EditorActions
      layout="stack"
      pending={false}
      savedLabel={null}
      actions={actions}
      canArchive={actions.archive}
      canUpdate={actions.updateLive}
      onSave={vi.fn()}
      onPublish={vi.fn()}
      onUpdate={vi.fn()}
      onUnpublish={vi.fn()}
      onArchive={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
}

describe("EditorActions", () => {
  it("shows save draft, publish, and archive for an admin draft", () => {
    renderActions("admin", "draft", false);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update live post" })).toBeNull();
  });

  it("hides publish, unpublish, and archive from a guest", () => {
    renderActions("guest", "draft", false);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update live post" })).toBeNull();

    renderActions("guest", "published", true);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "Publish" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Unpublish" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Archive" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Update live post" })).toHaveLength(0);
  });

  it("shows update live, unpublish, and archive when an admin has a pending revision", () => {
    renderActions("admin", "published", true);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update live post" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("hides update live until a published post has a pending revision", () => {
    renderActions("admin", "published", false);
    expect(screen.queryByRole("button", { name: "Update live post" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("offers no write actions on an archived post", () => {
    renderActions("admin", "archived", true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update live post" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
  });

  it("shows the saved clock and the guest live-unchanged banner", () => {
    const actions = getPostActions("guest", "published", false);
    render(
      <>
        <LiveUnchangedNotice />
        <EditorActions
          layout="stack"
          pending={false}
          savedLabel="Saved 14:05 IST"
          actions={actions}
          canArchive={false}
          canUpdate={false}
          onSave={vi.fn()}
          onPublish={vi.fn()}
          onUpdate={vi.fn()}
          onUnpublish={vi.fn()}
          onArchive={vi.fn()}
          onPreview={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText(LIVE_UNCHANGED_BANNER)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Saved 14:05 IST");
  });
});

describe("RevisionReview", () => {
  const review = {
    status: "published" as const,
    liveTitle: "Live title",
    liveSummary: "Live summary",
    liveHtml: "<p>Live body.</p>",
    pendingTitle: "Pending title",
    pendingSummary: "Pending summary",
    pendingHtml: "<p>Pending body.</p>",
    pendingAuthor: "Gus Guest",
    pendingUpdatedAt: "2026-10-13T08:35:00.000Z",
    liveChangedSinceBase: false,
    busy: false,
    onPublish: vi.fn(),
    onDiscard: vi.fn(),
  };

  it("shows publish and discard to an admin", () => {
    render(<RevisionReview role="admin" {...review} />);
    expect(screen.getByRole("region", { name: "Pending review" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pending" })).toBeTruthy();
    expect(screen.getByText("Live body.")).toBeTruthy();
    expect(screen.getByText("Pending body.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish revision" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("hides the review from a guest", () => {
    render(<RevisionReview role="guest" {...review} />);
    expect(screen.queryByRole("button", { name: "Publish revision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });
});
