import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockPostsApi, resetMockPosts } from "@/lib/posts-client.mock";
import {
  ApiError,
  apiErrorFromResponse,
  getPostsApi,
  httpPostsApi,
  parsePostList,
  setPostsApiForTesting,
} from "@/lib/posts-client";

const draftId = "11111111-1111-4111-8111-111111111111";
const publishedId = "22222222-2222-4222-8222-222222222222";
const archivedId = "44444444-4444-4444-8444-444444444444";

describe("apiErrorFromResponse", () => {
  it("maps validation fields and drops non-string messages", () => {
    const error = apiErrorFromResponse(
      { status: 400 },
      { error: "Check the form.", code: "validation", fields: { title: "Title is required.", slug: 12 } },
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("validation");
    expect(error.error).toBe("Check the form.");
    expect(error.fields).toEqual({ title: "Title is required." });
    expect(error.message).toBe("Check the form.");
  });

  it("infers validation, forbidden, and not_found when the body has no code", () => {
    expect(apiErrorFromResponse({ status: 400 }, { error: "Missing title." }).code).toBe("validation");
    expect(apiErrorFromResponse({ status: 403 }, { error: "No." }).code).toBe("forbidden");
    expect(apiErrorFromResponse({ status: 404 }, null).code).toBe("not_found");
    expect(apiErrorFromResponse({ status: 404 }, null).error).toBe("That post was not found.");
  });

  it("maps stale_version with the concurrency details", () => {
    const error = apiErrorFromResponse(
      { status: 409 },
      {
        error: "Someone else saved this post.",
        code: "stale_version",
        currentVersion: 4,
        updatedAt: "2026-10-13T08:35:00.000Z",
        updatedBy: "Ada Admin",
      },
    );
    expect(error.code).toBe("stale_version");
    expect(error.currentVersion).toBe("4");
    expect(error.updatedAt).toBe("2026-10-13T08:35:00.000Z");
    expect(error.updatedBy).toBe("Ada Admin");
  });

  it("maps slug_taken, revision_stale, and archived", () => {
    expect(apiErrorFromResponse({ status: 409 }, { error: "Taken.", code: "slug_taken", fields: { slug: "Taken." } }).code).toBe(
      "slug_taken",
    );
    expect(apiErrorFromResponse({ status: 409 }, { error: "Base moved.", code: "revision_stale" }).code).toBe("revision_stale");
    expect(apiErrorFromResponse({ status: 409 }, { error: "Archived.", code: "archived" }).code).toBe("archived");
  });

  it("maps 409 codes not_draft and not_published", () => {
    expect(apiErrorFromResponse({ status: 409 }, { error: "Only a draft can be published.", code: "not_draft" }).code).toBe(
      "not_draft",
    );
    expect(apiErrorFromResponse({ status: 409 }, { error: "Only a published post can be archived.", code: "not_published" }).code).toBe(
      "not_published",
    );
  });

  it("treats the current slug conflict, which has no code, as slug_taken", () => {
    const error = apiErrorFromResponse({ status: 409 }, { error: "That URL slug is already used." });
    expect(error.code).toBe("slug_taken");
    expect(error.error).toBe("That URL slug is already used.");
  });

  it("uses unknown for a code outside the contract", () => {
    const error = apiErrorFromResponse({ status: 409 }, { error: "Nope.", code: "exploded" });
    expect(error.code).toBe("unknown");
    expect(error.error).toBe("Nope.");
  });

  it("maps post_saved_version_failed on 500 with top-level id and slug", () => {
    const error = apiErrorFromResponse(
      { status: 500 },
      {
        error: "Draft was saved, but its version could not be retrieved.",
        code: "post_saved_version_failed",
        id: "post-uuid-43",
        slug: "post-slug-43",
      },
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("post_saved_version_failed");
    expect(error.id).toBe("post-uuid-43");
    expect(error.slug).toBe("post-slug-43");
    expect(error.error).toBe("Draft was saved, but its version could not be retrieved.");
  });

  it("uses a default message when the body is empty", () => {
    const error = apiErrorFromResponse({ status: 500 }, null);
    expect(error.code).toBe("unknown");
    expect(error.error).toBe("The request could not be completed.");
  });
});

describe("parsePostList", () => {
  it("rejects non-contract payloads", () => {
    expect(() =>
      parsePostList([
        { id: "1", title: "A", slug: "a", status: "draft", updatedAt: "2026-10-01T00:00:00.000Z" },
      ]),
    ).toThrow(ApiError);
    expect(() => parsePostList(null)).toThrow(ApiError);
    expect(() => parsePostList({ items: "not-an-array" })).toThrow(ApiError);
  });

  it("trusts a contract list payload", () => {
    const result = parsePostList(
      {
        items: [
          {
            id: "9",
            title: "Pending",
            slug: "pending",
            status: "published",
            hasPendingRevision: true,
            authorName: "Gus Guest",
            updatedAt: "2026-10-12T00:00:00.000Z",
            publishedAt: "2026-10-02T00:00:00.000Z",
          },
        ],
        total: 4,
      },
    );
    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.hasPendingRevision).toBe(true);
  });
});

describe("getPostsApi", () => {
  afterEach(() => {
    setPostsApiForTesting(null);
  });

  it("uses HTTP unless the mock flag is set", () => {
    const previous = process.env.NEXT_PUBLIC_POSTS_API_MOCK;
    delete process.env.NEXT_PUBLIC_POSTS_API_MOCK;
    expect(getPostsApi()).toBe(httpPostsApi);
    process.env.NEXT_PUBLIC_POSTS_API_MOCK = "1";
    expect(getPostsApi()).toBe(mockPostsApi);
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_POSTS_API_MOCK;
    } else {
      process.env.NEXT_PUBLIC_POSTS_API_MOCK = previous;
    }
  });

  it("allows test-only injection when NODE_ENV === 'test'", () => {
    const customApi = { ...httpPostsApi };
    setPostsApiForTesting(customApi);
    expect(getPostsApi()).toBe(customApi);
  });

  it("fails closed when NODE_ENV !== 'test'", () => {
    const prevMock = process.env.NEXT_PUBLIC_POSTS_API_MOCK;
    try {
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_POSTS_API_MOCK = "1";
      expect(() => getPostsApi()).toThrow("NEXT_PUBLIC_POSTS_API_MOCK is only allowed when NODE_ENV === 'test'");
      expect(() => setPostsApiForTesting(mockPostsApi)).toThrow(
        "setPostsApiForTesting is only allowed when NODE_ENV === 'test'",
      );
    } finally {
      vi.unstubAllEnvs();
      if (prevMock === undefined) {
        delete process.env.NEXT_PUBLIC_POSTS_API_MOCK;
      } else {
        process.env.NEXT_PUBLIC_POSTS_API_MOCK = prevMock;
      }
    }
  });
});

describe("httpPostsApi", () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ version: "2", publishedAt: "2026-10-14T12:00:00.000Z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishRevision posts /api/posts/{id}/revision/publish with version and force", async () => {
    await httpPostsApi.publishRevision(publishedId, { version: "4", force: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/posts/${publishedId}/revision/publish`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ version: "4", force: true }),
      }),
    );
  });

  it("archivePost posts /api/posts/{id}/archive", async () => {
    await httpPostsApi.archivePost(publishedId, { version: "4" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/posts/${publishedId}/archive`,
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("publishPost posts /api/posts/{id}/publish with version", async () => {
    await httpPostsApi.publishPost(draftId, { version: "4" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/posts/${draftId}/publish`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ version: "4" }),
      }),
    );
  });

  it("publishPost's input type rejects force", () => {
    // @ts-expect-error PublishDraftInput has no force; only publishRevision accepts it
    const rejected: Parameters<typeof httpPostsApi.publishPost>[1] = { version: "4", force: true };
    expect(rejected.version).toBe("4");
  });

  it("unpublishPost posts /api/posts/{id}/unpublish and parses the full post detail", async () => {
    const rawPost = {
      id: publishedId,
      title: "Shipping the desk",
      slug: "shipping-the-desk",
      summary: "What is live today.",
      tags: ["release"],
      seoTitle: "Shipping the desk",
      seoKeywords: ["desk"],
      bodyHtml: "<p>Live introduction.</p>",
      status: "draft",
      authorId: "mock-author",
      authorName: "Ada Admin",
      createdAt: "2026-10-01T04:00:00.000Z",
      updatedAt: "2026-10-14T12:00:00.000Z",
      publishedAt: "2026-10-02T04:00:00.000Z",
      version: "4",
      pendingRevision: null,
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(rawPost), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await httpPostsApi.unpublishPost(publishedId, { version: "3" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/posts/${publishedId}/unpublish`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ version: "3" }),
      }),
    );
    expect(result).toEqual(rawPost);
    expect(result.publishedAt).toBe("2026-10-02T04:00:00.000Z");
    expect(result.status).toBe("draft");
    expect(result.pendingRevision).toBeNull();
  });
});

describe("mockPostsApi", () => {
  beforeEach(() => {
    resetMockPosts();
  });

  it("writes a published edit to a pending revision and leaves the live row", async () => {
    const live = await mockPostsApi.getPost(publishedId);
    await mockPostsApi.deleteRevision(publishedId, { version: "1" });
    const saved = await mockPostsApi.patchPost(publishedId, {
      version: live.version,
      title: "Shipping the desk (review)",
      bodyHtml: "<p>Pending body.</p>",
    });
    expect(saved.appliedTo).toBe("pendingRevision");
    const after = await mockPostsApi.getPost(publishedId);
    expect(after.title).toBe(live.title);
    expect(after.version).toBe(live.version);
    expect(after.bodyHtml).toBe("<p>Live introduction.</p>");
    const revision = await mockPostsApi.getRevision(publishedId);
    expect(revision.title).toBe("Shipping the desk (review)");
    expect(revision.version).toBe(saved.version);
    expect(revision.baseVersion).toBe(live.version);
  });

  it("rejects a stale version", async () => {
    const error = await mockPostsApi.patchPost(draftId, { version: "nope", title: "Nope" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "stale_version", currentVersion: "1", updatedBy: "Ada Admin" });
  });

  it("requires force when the live row moved after the revision was started", async () => {
    const live = await mockPostsApi.getPost(publishedId);
    const revision = await mockPostsApi.getRevision(publishedId);
    const unpublished = await mockPostsApi.unpublishPost(publishedId, { version: live.version });
    await mockPostsApi.publishPost(publishedId, { version: unpublished.version });
    const stale = await mockPostsApi
      .publishRevision(publishedId, { version: revision.version })
      .catch((caught: unknown) => caught);
    expect(stale).toMatchObject({ code: "revision_stale" });
    const forced = await mockPostsApi.publishRevision(publishedId, { version: revision.version, force: true });
    const after = await mockPostsApi.getPost(publishedId);
    expect(after.status).toBe("published");
    expect(after.pendingRevision).toBeNull();
    expect(after.version).toBe(forced.version);
    expect(after.summary).toBe("Pending summary.");
  });

  it("rejects a duplicate slug and publishing an archived post", async () => {
    const duplicate = await mockPostsApi
      .createPost({
        title: "Copy",
        slug: "desk-notes",
        summary: "",
        tags: "",
        seoKeywords: "",
        seoTitle: "",
        bodyHtml: "<p>Copy.</p>",
      })
      .catch((caught: unknown) => caught);
    expect(duplicate).toMatchObject({ code: "slug_taken", status: 409 });

    const archived = await mockPostsApi.getPost(archivedId);
    const blocked = await mockPostsApi
      .publishPost(archivedId, { version: archived.version })
      .catch((caught: unknown) => caught);
    expect(blocked).toMatchObject({ code: "archived" });
  });

  it("filters the list to posts with a pending revision", async () => {
    const pending = await mockPostsApi.listPosts({ pending: true });
    expect(pending.total).toBe(1);
    expect(pending.items[0]?.id).toBe(publishedId);
    expect(pending.items[0]?.hasPendingRevision).toBe(true);
    const drafts = await mockPostsApi.listPosts({ status: "draft" });
    expect(drafts.items.every((item) => item.status === "draft")).toBe(true);
  });

  it("unpublishPost preserves publishedAt, sets status to draft, and clears pending revision", async () => {
    const live = await mockPostsApi.getPost(publishedId);
    expect(live.status).toBe("published");
    expect(live.publishedAt).toBe("2026-10-02T04:00:00.000Z");
    expect(live.pendingRevision).not.toBeNull();

    const unpublished = await mockPostsApi.unpublishPost(publishedId, { version: live.version });
    expect(unpublished.status).toBe("draft");
    expect(unpublished.publishedAt).toBe("2026-10-02T04:00:00.000Z");
    expect(unpublished.pendingRevision).toBeNull();
    expect(unpublished.version).not.toBe(live.version);

    const stored = await mockPostsApi.getPost(publishedId);
    expect(stored.status).toBe("draft");
    expect(stored.publishedAt).toBe("2026-10-02T04:00:00.000Z");
    expect(stored.pendingRevision).toBeNull();
  });
});
