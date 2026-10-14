import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PostEditor } from "@/app/(desk)/posts/post-editor";
import {
  ApiError,
  setPostsApiForTesting,
  type PostDetail,
  type PostsApi,
} from "@/lib/posts-client";
import { formatIstDateTime } from "@/lib/format-ist";
import { mockPostsApi, resetMockPosts } from "@/lib/posts-client.mock";

const mockRouterReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockRouterReplace,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@tinymce/tinymce-react", () => ({
  Editor: ({
    initialValue,
    onEditorChange,
  }: {
    initialValue?: string;
    onEditorChange?: (content: string) => void;
  }) => (
    <textarea
      data-testid="mock-tinymce-editor"
      defaultValue={initialValue ?? ""}
      onChange={(e) => onEditorChange?.(e.target.value)}
    />
  ),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const publishedId = "22222222-2222-4222-8222-222222222222";

const samplePost: PostDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Server Post Title",
  slug: "server-post-title",
  summary: "Server post summary",
  tags: ["engineering"],
  seoTitle: "SEO Title",
  seoKeywords: ["code"],
  bodyHtml: "<p>Server post body content</p>",
  status: "draft",
  authorId: "user-1",
  authorName: "Alex Author",
  createdAt: "2026-10-14T09:00:00.000Z",
  updatedAt: "2026-10-14T09:30:00.000Z",
  publishedAt: null,
  version: "2",
  pendingRevision: null,
};

function createMockApi(overrides: Partial<PostsApi> = {}): PostsApi {
  return {
    listPosts: vi.fn(async () => ({ items: [], total: 0 })),
    getPost: vi.fn(async () => samplePost),
    createPost: vi.fn(async () => ({
      id: "new-post-id",
      slug: "new-post-slug",
      version: "1",
    })),
    patchPost: vi.fn(async () => ({
      version: "3",
      updatedAt: "2026-10-14T10:00:00.000Z",
      appliedTo: "live" as const,
    })),
    getRevision: vi.fn(),
    deleteRevision: vi.fn(async () => {}),
    publishPost: vi.fn(async () => ({
      version: "3",
      publishedAt: "2026-10-14T10:00:00.000Z",
    })),
    publishRevision: vi.fn(),
    unpublishPost: vi.fn(),
    archivePost: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("PostEditor flows", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockRouterReplace.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setPostsApiForTesting(null);
    vi.restoreAllMocks();
  });

  describe("Item (1): Stale draft protection and baseVersion concurrency", () => {
    it("sends the draft baseVersion on save so 409 stale_version shows conflict screen and never overwrites", async () => {
      // The server copy is at version 2.
      // The restored draft was saved against baseVersion "1".
      localStorage.setItem(
        `pixel:draft:user-1:${samplePost.id}`,
        JSON.stringify({
          userId: "user-1",
          postId: samplePost.id,
          title: "Restored title from draft",
          body: "<p>Restored body from draft</p>",
          savedAt: "2026-10-14T10:00:00.000Z",
          baseVersion: "1",
        }),
      );

      const patchPostSpy = vi.fn(async () => {
        throw new ApiError({
          status: 409,
          code: "stale_version",
          error: "Someone else saved this post.",
          currentVersion: "2",
          updatedAt: "2026-10-14T09:30:00.000Z",
          updatedBy: "Ada Admin",
        });
      });

      const mockApi = createMockApi({ patchPost: patchPostSpy });
      setPostsApiForTesting(mockApi);

      render(
        <PostEditor
          mode="edit"
          role="admin"
          userId="user-1"
          initialPost={samplePost}
        />,
      );

      // Verify draft recovery banner is rendered indicating changed server copy
      expect(screen.getByLabelText("Draft recovery")).toBeTruthy();
      expect(screen.getByText(/The server copy changed since this draft/)).toBeTruthy();

      // Click Restore
      const restoreBtn = screen.getByRole("button", { name: "Restore" });
      fireEvent.click(restoreBtn);

      // Verify restored content is loaded into the form fields
      expect(screen.getByDisplayValue("Restored title from draft")).toBeTruthy();

      // Click Save draft
      const saveBtn = screen.getAllByRole("button", { name: "Save draft" })[0];
      fireEvent.click(saveBtn);

      // Assert that patchPost was called with baseVersion "1" (the version it was loaded at), NOT "2"
      await waitFor(() => {
        expect(patchPostSpy).toHaveBeenCalledTimes(1);
      });

      expect(patchPostSpy).toHaveBeenCalledWith(
        samplePost.id,
        expect.objectContaining({
          version: "1",
          title: "Restored title from draft",
        }),
      );

      // Assert that 409 stale_version renders the conflict screen
      await waitFor(() => {
        const conflictAlert = screen.getByRole("alert");
        expect(conflictAlert).toBeTruthy();
        expect(conflictAlert.textContent).toContain("Someone else saved this post.");
        expect(conflictAlert.textContent).toContain("Updated by Ada Admin");
        expect(conflictAlert.textContent).toContain("Reload discards unsaved edits.");
      });

      // Assert that Reload button is available on the conflict screen
      expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    });
  });

  describe("Item (2): User isolation for draft snapshots", () => {
    it("ensures user B never sees user A's draft on the same post", () => {
      // User A saved a local draft
      localStorage.setItem(
        `pixel:draft:user-a:${samplePost.id}`,
        JSON.stringify({
          userId: "user-a",
          postId: samplePost.id,
          title: "Confidential Draft from User A",
          body: "<p>Private thoughts</p>",
          savedAt: "2026-10-14T10:00:00.000Z",
          baseVersion: samplePost.version,
        }),
      );

      const mockApi = createMockApi();
      setPostsApiForTesting(mockApi);

      // User B opens the exact same post
      render(
        <PostEditor
          mode="edit"
          role="admin"
          userId="user-b"
          initialPost={samplePost}
        />,
      );

      // Draft recovery banner MUST NOT appear for User B
      expect(screen.queryByLabelText("Draft recovery")).toBeNull();
      expect(screen.queryByText(/Confidential Draft from User A/)).toBeNull();

      // User B sees the original server copy
      expect(screen.getByDisplayValue(samplePost.title)).toBeTruthy();

      // User A's draft was pruned from storage when User B opened the editor
      expect(localStorage.getItem(`pixel:draft:user-a:${samplePost.id}`)).toBeNull();
    });
  });

  describe("Item (3): Single request on post creation without fallback GET (issue #35)", () => {
    it("creates a new post using POST response {id,slug,version} with a single request and no fallback GET", async () => {
      const createPostSpy = vi.fn(async () => ({
        id: "created-post-uuid-35",
        slug: "brand-new-post",
        version: "1",
      }));
      const getPostSpy = vi.fn(async () => samplePost);

      const mockApi = createMockApi({
        createPost: createPostSpy,
        getPost: getPostSpy,
      });
      setPostsApiForTesting(mockApi);

      render(<PostEditor mode="create" role="admin" userId="user-1" />);

      // Fill in required fields
      const titleInput = screen.getByPlaceholderText("Write your headline…");
      fireEvent.change(titleInput, { target: { value: "Brand New Post" } });

      const slugInput = screen.getByPlaceholderText("e.g. my-awesome-post");
      fireEvent.change(slugInput, { target: { value: "brand-new-post" } });

      const bodyInput = screen.getByTestId("mock-tinymce-editor");
      fireEvent.change(bodyInput, { target: { value: "<p>Brand new body</p>" } });

      // Save the draft
      const saveBtn = screen.getAllByRole("button", { name: "Save draft" })[0];
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(createPostSpy).toHaveBeenCalledTimes(1);
      });

      expect(createPostSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Brand New Post",
          slug: "brand-new-post",
        }),
      );

      // Issue #35: Assert that getPost was NEVER called (fallback GET was removed)
      expect(getPostSpy).not.toHaveBeenCalled();

      // Assert that the created post id is stored in sessionStorage
      expect(sessionStorage.getItem("desk-post-saved:created-post-uuid-35")).toBeTruthy();
    });
  });

  describe("Item (4): Visible accessible placeholder in preview for relative img src (issue #30)", () => {
    it("renders a visible accessible placeholder in the preview dialog for relative images not starting with /media/", () => {
      const mockApi = createMockApi();
      setPostsApiForTesting(mockApi);

      render(
        <PostEditor
          mode="edit"
          role="admin"
          userId="user-1"
          initialPost={{
            ...samplePost,
            bodyHtml: '<p>Illustration: <img src="/images/architecture.png" alt="Architecture Diagram"></p>',
          }}
        />,
      );

      // Open the preview dialog
      const previewBtn = screen.getAllByRole("button", { name: "Preview" })[0];
      fireEvent.click(previewBtn);

      const previewBody = document.querySelector(".blog-preview-body");
      expect(previewBody).toBeTruthy();

      // Assert accessible role="img" and accessible name
      const placeholder = screen.getByRole("img", { name: "Architecture Diagram" });
      expect(placeholder).toBeTruthy();
      expect(placeholder.classList.contains("image-placeholder")).toBe(true);

      // Assert visible text content inside the placeholder
      expect(placeholder.textContent).toContain("[Image: Architecture Diagram]");

      // Assert no raw img with /images/architecture.png was rendered
      expect(previewBody?.querySelector("img")).toBeNull();
    });
  });

  describe("Item (5): Client handling for post_saved_version_failed (issue #43)", () => {
    it("on POST create 500 with post_saved_version_failed, treats as saved, navigates by id, GETs once for version, and never retries create", async () => {
      const savedPostId = "saved-post-uuid-43";
      const savedPostSlug = "recovered-slug";
      const recoveredVersion = "version-token-43";

      const createPostSpy = vi.fn(async () => {
        throw new ApiError({
          status: 500,
          code: "post_saved_version_failed",
          error: "Draft was saved, but its version could not be retrieved.",
          id: savedPostId,
          slug: savedPostSlug,
        });
      });

      const getPostSpy = vi.fn(async (id: string) => ({
        ...samplePost,
        id,
        slug: savedPostSlug,
        version: recoveredVersion,
      }));

      const patchPostSpy = vi.fn(async () => ({
        version: "version-token-44",
        updatedAt: "2026-10-14T11:00:00.000Z",
        appliedTo: "live" as const,
      }));

      const mockApi = createMockApi({
        createPost: createPostSpy,
        getPost: getPostSpy,
        patchPost: patchPostSpy,
      });
      setPostsApiForTesting(mockApi);

      render(<PostEditor mode="create" role="admin" userId="user-1" />);

      // Fill in required fields
      const titleInput = screen.getByPlaceholderText("Write your headline…");
      fireEvent.change(titleInput, { target: { value: "Recovered Post Title" } });

      const slugInput = screen.getByPlaceholderText("e.g. my-awesome-post");
      fireEvent.change(slugInput, { target: { value: "original-slug" } });

      const bodyInput = screen.getByTestId("mock-tinymce-editor");
      fireEvent.change(bodyInput, { target: { value: "<p>Recovered post body</p>" } });

      // Save the draft
      const saveBtn = screen.getAllByRole("button", { name: "Save draft" })[0];
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(createPostSpy).toHaveBeenCalledTimes(1);
      });

      // Assert GET once for version with the post id
      await waitFor(() => {
        expect(getPostSpy).toHaveBeenCalledTimes(1);
      });
      expect(getPostSpy).toHaveBeenCalledWith(savedPostId);

      // Assert treated as saved:
      // 1. Session storage marked with saved post ID
      expect(sessionStorage.getItem(`desk-post-saved:${savedPostId}`)).toBeTruthy();

      // 2. Navigated / opened by id
      expect(mockRouterReplace).toHaveBeenCalledWith(`/posts/${savedPostId}`);

      // 3. No error banner is displayed
      expect(screen.queryByRole("alert")).toBeNull();

      // 4. Never retry create: saving again performs PATCH, never calling createPost again
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(patchPostSpy).toHaveBeenCalledTimes(1);
      });
      expect(createPostSpy).toHaveBeenCalledTimes(1);
      expect(patchPostSpy).toHaveBeenCalledWith(
        savedPostId,
        expect.objectContaining({
          version: recoveredVersion,
        }),
      );
    });

    it("does not treat as saved if 500 error is not post_saved_version_failed", async () => {
      const createPostSpy = vi.fn(async () => {
        throw new ApiError({
          status: 500,
          code: "unknown",
          error: "Internal server error.",
        });
      });
      const getPostSpy = vi.fn(async () => samplePost);

      const mockApi = createMockApi({
        createPost: createPostSpy,
        getPost: getPostSpy,
      });
      setPostsApiForTesting(mockApi);

      render(<PostEditor mode="create" role="admin" userId="user-1" />);

      const titleInput = screen.getByPlaceholderText("Write your headline…");
      fireEvent.change(titleInput, { target: { value: "Some Title" } });

      const bodyInput = screen.getByTestId("mock-tinymce-editor");
      fireEvent.change(bodyInput, { target: { value: "<p>Some body</p>" } });

      const saveBtn = screen.getAllByRole("button", { name: "Save draft" })[0];
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(createPostSpy).toHaveBeenCalledTimes(1);
      });

      // Did NOT call getPost
      expect(getPostSpy).not.toHaveBeenCalled();

      // Did NOT navigate
      expect(mockRouterReplace).not.toHaveBeenCalled();

      // Error banner is displayed
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("Internal server error.");
      });
    });
  });

  describe("Item (6): Status and reload when post_saved_version_failed getPost also fails (issue #49)", () => {
    it("when create returns post_saved_version_failed and follow-up getPost also fails, does not set an empty version, shows role=status 'Saved. Reload to continue editing.' with Reload button, disables save/publish, and reloads to continue editing", async () => {
      const savedPostId = "saved-post-uuid-49";
      const savedPostSlug = "recovered-slug-49";
      const recoveredVersion = "version-token-49";

      const createPostSpy = vi.fn(async () => {
        throw new ApiError({
          status: 500,
          code: "post_saved_version_failed",
          error: "Draft was saved, but its version could not be retrieved.",
          id: savedPostId,
          slug: savedPostSlug,
        });
      });

      let getPostCallCount = 0;
      const getPostSpy = vi.fn(async (id: string) => {
        getPostCallCount++;
        if (getPostCallCount === 1) {
          throw new ApiError({
            status: 500,
            code: "unknown",
            error: "Could not load post.",
          });
        }
        return {
          ...samplePost,
          id,
          slug: savedPostSlug,
          version: recoveredVersion,
          updatedAt: "2026-10-14T11:30:00.000Z",
        };
      });

      const patchPostSpy = vi.fn(async () => ({
        version: "version-token-50",
        updatedAt: "2026-10-14T12:00:00.000Z",
        appliedTo: "live" as const,
      }));

      const publishPostSpy = vi.fn(async () => ({
        version: "version-token-51",
        publishedAt: "2026-10-14T12:00:00.000Z",
      }));

      const mockApi = createMockApi({
        createPost: createPostSpy,
        getPost: getPostSpy,
        patchPost: patchPostSpy,
        publishPost: publishPostSpy,
      });
      setPostsApiForTesting(mockApi);

      render(<PostEditor mode="create" role="admin" userId="user-1" />);

      const titleInput = screen.getByPlaceholderText("Write your headline…");
      fireEvent.change(titleInput, { target: { value: "Post 49 Title" } });

      const slugInput = screen.getByPlaceholderText("e.g. my-awesome-post");
      fireEvent.change(slugInput, { target: { value: "post-49-slug" } });

      const bodyInput = screen.getByTestId("mock-tinymce-editor");
      fireEvent.change(bodyInput, { target: { value: "<p>Post 49 body</p>" } });

      const saveBtn = screen.getAllByRole("button", { name: "Save draft" })[0];
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(createPostSpy).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(getPostSpy).toHaveBeenCalledTimes(1);
      });
      expect(getPostSpy).toHaveBeenCalledWith(savedPostId);

      // Did NOT navigate by id yet because version failed to load
      expect(mockRouterReplace).not.toHaveBeenCalled();

      // Accessible status with role="status" and text 'Saved. Reload to continue editing.'
      const statusElement = screen.getByRole("status");
      expect(statusElement).toBeTruthy();
      expect(statusElement.textContent).toContain("Saved. Reload to continue editing.");

      // Reload button is present
      const reloadBtn = screen.getByRole("button", { name: "Reload" });
      expect(reloadBtn).toBeTruthy();

      // Save draft is disabled
      expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

      // Clicking Save draft while saveBlocked does not retry create nor perform patch
      fireEvent.click(saveBtn);
      expect(createPostSpy).toHaveBeenCalledTimes(1);
      expect(patchPostSpy).not.toHaveBeenCalled();

      // Clicking Publish while saveBlocked does not publish
      const publishBtn = screen.queryAllByRole("button", { name: "Publish" })[0];
      if (publishBtn) {
        fireEvent.click(publishBtn);
      }
      expect(publishPostSpy).not.toHaveBeenCalled();

      // No error banner (role="alert")
      expect(screen.queryByRole("alert")).toBeNull();

      // Click Reload to load the version
      fireEvent.click(reloadBtn);

      await waitFor(() => {
        expect(getPostSpy).toHaveBeenCalledTimes(2);
      });
      expect(getPostSpy).toHaveBeenLastCalledWith(savedPostId);

      // Status is cleared
      await waitFor(() => {
        expect(screen.queryByText("Saved. Reload to continue editing.")).toBeNull();
      });
      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();

      // Save draft is re-enabled
      expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

      // Navigated to post URL and session storage saved
      expect(mockRouterReplace).toHaveBeenCalledWith(`/posts/${savedPostId}`);
      expect(sessionStorage.getItem(`desk-post-saved:${savedPostId}`)).toBeTruthy();

      // Saving now performs patch with loaded version, not create
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(patchPostSpy).toHaveBeenCalledTimes(1);
      });
      expect(createPostSpy).toHaveBeenCalledTimes(1);
      expect(patchPostSpy).toHaveBeenCalledWith(
        savedPostId,
        expect.objectContaining({
          version: recoveredVersion,
        }),
      );
    });
  });

  describe("Item (6): Unpublish post (after unpublish the editor keeps the server's publishedAt and shows no pending revision)", () => {
    it("after unpublish the editor keeps publishedAt and shows no pending revision", async () => {
      resetMockPosts();
      setPostsApiForTesting(mockPostsApi);
      const initialPost = await mockPostsApi.getPost(publishedId);
      const initialRevision = await mockPostsApi.getRevision(publishedId);

      expect(initialPost.status).toBe("published");
      expect(initialPost.publishedAt).toBe("2026-10-02T04:00:00.000Z");
      expect(initialPost.pendingRevision).not.toBeNull();

      render(
        <PostEditor
          mode="edit"
          role="admin"
          userId="user-1"
          initialPost={initialPost}
          initialRevision={initialRevision}
        />,
      );

      // Initial state: pending review banner is shown, status is published, published date is shown
      expect(screen.getByRole("region", { name: "Pending review" })).toBeTruthy();
      expect(screen.getAllByRole("button", { name: "Update live post" }).length).toBeGreaterThan(0);
      const initialStatusDt = screen.getByText("Status");
      const initialStatusDd = initialStatusDt.nextElementSibling as HTMLElement;
      expect(within(initialStatusDd).getByText("Published")).toBeTruthy();

      const initialPubDt = screen.getByText("Published date");
      const initialPubDd = initialPubDt.nextElementSibling as HTMLElement;
      const initialTime = within(initialPubDd).getByText(formatIstDateTime(initialPost.publishedAt!));
      expect(initialTime.tagName).toBe("TIME");
      expect(initialTime.getAttribute("datetime")).toBe(initialPost.publishedAt);

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

      // 1. Status dd shows Draft
      const statusDt = screen.getByText("Status");
      const statusDd = statusDt.nextElementSibling as HTMLElement;
      expect(within(statusDd).getByText("Draft")).toBeTruthy();
      expect(within(statusDd).queryByText("Published")).toBeNull();

      // 2. Published date dd still shows the formatted date in a <time> element
      const pubDt = screen.getByText("Published date");
      const pubDd = pubDt.nextElementSibling as HTMLElement;
      const time = within(pubDd).getByText(formatIstDateTime(initialPost.publishedAt!));
      expect(time.tagName).toBe("TIME");
      expect(time.getAttribute("datetime")).toBe(initialPost.publishedAt);

      // 3. Pending-revision banner gone
      expect(screen.queryByRole("region", { name: "Pending review" })).toBeNull();
      expect(screen.queryByText("Pending review")).toBeNull();
      expect(screen.queryAllByRole("button", { name: "Update live post" })).toHaveLength(0);
    });

    it("renders 'Not published' for a never-published post", () => {
      render(
        <PostEditor
          mode="edit"
          role="admin"
          userId="user-1"
          initialPost={samplePost}
        />,
      );

      const statusDt = screen.getByText("Status");
      const statusDd = statusDt.nextElementSibling as HTMLElement;
      expect(within(statusDd).getByText("Draft")).toBeTruthy();

      const pubDt = screen.getByText("Published date");
      const pubDd = pubDt.nextElementSibling as HTMLElement;
      expect(within(pubDd).getByText("Not published")).toBeTruthy();
      expect(pubDd.querySelector("time")).toBeNull();
    });
  });
});
