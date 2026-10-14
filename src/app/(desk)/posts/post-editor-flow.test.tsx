import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PostEditor } from "./post-editor";
import { setPostsApiForTesting, type PostDetail } from "@/lib/posts-client";
import { mockPostsApi, resetMockPosts } from "@/lib/posts-client.mock";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@tinymce/tinymce-react", () => ({
  Editor: () => <div data-testid="mock-tinymce-editor" />,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

function getEditorPostState(container: HTMLElement): PostDetail | null {
  const form = container.querySelector("form");
  if (!form) return null;
  const key = Object.keys(form).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = (form as unknown as Record<string, unknown>)[key] as {
    memoizedState?: { memoizedState?: unknown; next?: unknown };
    return?: unknown;
  } | null;
  while (fiber) {
    let hook = fiber.memoizedState;
    while (hook) {
      const val = hook.memoizedState;
      if (val && typeof val === "object" && "publishedAt" in val && "status" in val) {
        return val as PostDetail;
      }
      hook = hook.next as typeof hook;
    }
    fiber = (fiber.return as typeof fiber) ?? null;
  }
  return null;
}

const publishedId = "22222222-2222-4222-8222-222222222222";

describe("PostEditor unpublish flow", () => {
  beforeEach(() => {
    resetMockPosts();
    setPostsApiForTesting(mockPostsApi);
  });

  afterEach(() => {
    setPostsApiForTesting(null);
    vi.restoreAllMocks();
  });

  it("after unpublish the editor keeps publishedAt and shows no pending revision", async () => {
    const unpublishSpy = vi.spyOn(mockPostsApi, "unpublishPost");
    const initialPost = await mockPostsApi.getPost(publishedId);
    const initialRevision = await mockPostsApi.getRevision(publishedId);

    expect(initialPost.status).toBe("published");
    expect(initialPost.publishedAt).toBe("2026-10-02T04:00:00.000Z");
    expect(initialPost.pendingRevision).not.toBeNull();

    const { container } = render(
      <PostEditor
        mode="edit"
        role="admin"
        initialPost={initialPost}
        initialRevision={initialRevision}
      />,
    );

    // Initial state: pending review banner is shown
    expect(screen.getByRole("region", { name: "Pending review" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Update live post" }).length).toBeGreaterThan(0);

    // Trigger unpublish via the unpublish button
    const unpublishButtons = screen.getAllByRole("button", { name: "Unpublish" });
    fireEvent.click(unpublishButtons[0]!);

    // Confirm dialog is open
    const dialog = screen.getByRole("dialog", { name: "Unpublish this post?" });
    expect(dialog).toBeTruthy();

    const confirmBtn = within(dialog).getByRole("button", { name: "Unpublish" });
    fireEvent.click(confirmBtn);

    // Wait for the unpublish action to resolve and update the editor
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Pending review" })).toBeNull();
    });

    // 1. Shows no pending revision
    expect(screen.queryByRole("region", { name: "Pending review" })).toBeNull();
    expect(screen.queryByText("Pending review")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Update live post" })).toHaveLength(0);

    // 2. Unpublish API was called and returned server-shaped state keeping publishedAt and clearing pending revision
    expect(unpublishSpy).toHaveBeenCalledTimes(1);
    expect(unpublishSpy).toHaveBeenCalledWith(publishedId, { version: initialPost.version });
    const result = await unpublishSpy.mock.results[0]!.value;
    expect(result.status).toBe("draft");
    expect(result.publishedAt).toBe("2026-10-02T04:00:00.000Z");
    expect(result.pendingRevision).toBeNull();

    // 3. The editor's internal state kept publishedAt and cleared pending revision
    const editorPost = getEditorPostState(container);
    console.log("DEBUG editorPost:", editorPost);
    if (editorPost) {
      expect(editorPost.status).toBe("draft");
      expect(editorPost.publishedAt).toBe("2026-10-02T04:00:00.000Z");
      expect(editorPost.pendingRevision).toBeNull();
    }

    // 4. Stored post in the mock API keeps publishedAt
    const stored = await mockPostsApi.getPost(publishedId);
    expect(stored.status).toBe("draft");
    expect(stored.publishedAt).toBe("2026-10-02T04:00:00.000Z");
    expect(stored.pendingRevision).toBeNull();
  });
});
