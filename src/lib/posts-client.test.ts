import { beforeEach, describe, expect, it } from "vitest";

import { mockPostsApi, resetMockPosts } from "@/lib/posts-client.mock";
import {
  ApiError,
  apiErrorFromResponse,
  getPostsApi,
  httpPostsApi,
  parsePostList,
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

  it("uses a default message when the body is empty", () => {
    const error = apiErrorFromResponse({ status: 500 }, null);
    expect(error.code).toBe("unknown");
    expect(error.error).toBe("The request could not be completed.");
  });
});

describe("parsePostList", () => {
  it("adapts today's bare array and applies filters locally", () => {
    const result = parsePostList(
      [
        { id: "1", title: "A", slug: "a", status: "draft", updatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "2", title: "B", slug: "b", status: "published", updatedAt: "2026-10-02T00:00:00.000Z" },
      ],
      { status: "published" },
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: "2",
      status: "published",
      hasPendingRevision: false,
      authorName: "",
      publishedAt: null,
    });
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
      { status: "draft" },
    );
    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.hasPendingRevision).toBe(true);
  });
});

describe("getPostsApi", () => {
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
    const unpublished = await mockPostsApi.unpublishPost(publishedId, { version: live.version });
    const stale = await mockPostsApi
      .publishPost(publishedId, { version: unpublished.version })
      .catch((caught: unknown) => caught);
    expect(stale).toMatchObject({ code: "revision_stale" });
    const forced = await mockPostsApi.publishPost(publishedId, { version: unpublished.version, force: true });
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
});
