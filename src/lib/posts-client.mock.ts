/**
 * MOCK posts API. In-memory only — not the server.
 *
 * Selected by getPostsApi() when NEXT_PUBLIC_POSTS_API_MOCK=1.
 * Covers the slice-1 contract, including list, because live GET /api/posts
 * has no hasPendingRevision yet.
 *
 * Role checks are not enforced. The desk hides admin actions, and the real
 * API answers 403 or 404. Do not treat this store as a security boundary.
 *
 * ApiError is used only inside handlers, after posts-client has finished
 * initializing (the two modules import each other).
 */
import {
  ApiError,
  type CreatePostInput,
  type CreatePostResult,
  type ListPostsQuery,
  type PatchPostInput,
  type PatchPostResult,
  type PostDetail,
  type PostListResult,
  type PostStatus,
  type PostsApi,
  type PublishDraftInput,
  type PublishPostResult,
  type PublishRevisionInput,
  type RevisionDetail,
  type RevisionMutationInput,
  type UnpublishPostResult,
} from "@/lib/posts-client";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Memory = {
  posts: PostDetail[];
  revisions: Map<string, RevisionDetail>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function bump(version: string): string {
  const current = Number(version);
  return Number.isFinite(current) ? String(current + 1) : `${version}-2`;
}

function stale(post: PostDetail): ApiError {
  return new ApiError({
    status: 409,
    error: "Someone else saved this post.",
    code: "stale_version",
    currentVersion: post.version,
    updatedAt: post.updatedAt,
    updatedBy: post.authorName,
  });
}

function notFound(message = "That post was not found."): ApiError {
  return new ApiError({ status: 404, error: message, code: "not_found" });
}

function validation(fields: Record<string, string>): ApiError {
  return new ApiError({
    status: 400,
    error: "Check the highlighted fields.",
    code: "validation",
    fields,
  });
}

function slugTaken(): ApiError {
  return new ApiError({
    status: 409,
    error: "That URL slug is already used.",
    code: "slug_taken",
    fields: { slug: "That URL slug is already used." },
  });
}

function seed(): Memory {
  const created = "2026-10-01T04:00:00.000Z";
  const publishedAt = "2026-10-02T04:00:00.000Z";
  const revisionAt = "2026-10-12T04:00:00.000Z";
  const pending = {
    id: "33333333-3333-4333-8333-333333333333",
    authorName: "Gus Guest",
    updatedAt: revisionAt,
  };
  const draft: PostDetail = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Desk notes",
    slug: "desk-notes",
    summary: "A draft sitting on the desk.",
    tags: ["notes"],
    seoTitle: "",
    seoKeywords: [],
    bodyHtml: "<p>Draft body.</p>",
    status: "draft",
    authorId: "mock-author",
    authorName: "Ada Admin",
    createdAt: created,
    updatedAt: created,
    publishedAt: null,
    version: "1",
    pendingRevision: null,
  };
  const published: PostDetail = {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Shipping the desk",
    slug: "shipping-the-desk",
    summary: "What is live today.",
    tags: ["release"],
    seoTitle: "Shipping the desk",
    seoKeywords: ["desk"],
    bodyHtml: "<p>Live introduction.</p>",
    status: "published",
    authorId: "mock-author",
    authorName: "Ada Admin",
    createdAt: created,
    updatedAt: publishedAt,
    publishedAt,
    version: "3",
    pendingRevision: pending,
  };
  const archived: PostDetail = {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Retired announcement",
    slug: "retired-announcement",
    summary: "",
    tags: [],
    seoTitle: "",
    seoKeywords: [],
    bodyHtml: "<p>Old news.</p>",
    status: "archived",
    authorId: "mock-author",
    authorName: "Ada Admin",
    createdAt: created,
    updatedAt: "2026-09-01T04:00:00.000Z",
    publishedAt: "2026-08-01T04:00:00.000Z",
    version: "2",
    pendingRevision: null,
  };
  const revision: RevisionDetail = {
    id: published.id,
    revisionId: pending.id,
    title: "Shipping the desk",
    slug: published.slug,
    summary: "Pending summary.",
    tags: ["release", "review"],
    seoTitle: "Shipping the desk",
    seoKeywords: ["desk", "review"],
    bodyHtml: "<p>Pending introduction.</p>",
    status: "published",
    authorId: "mock-guest",
    authorName: "Gus Guest",
    createdAt: revisionAt,
    updatedAt: revisionAt,
    publishedAt,
    version: "1",
    baseVersion: published.version,
    liveChangedSinceBase: false,
  };
  return {
    posts: [published, draft, archived],
    revisions: new Map([[published.id, revision]]),
  };
}

const memory: Memory = seed();

export function resetMockPosts(): void {
  const next = seed();
  memory.posts = next.posts;
  memory.revisions = next.revisions;
}

function requirePost(id: string): PostDetail {
  const post = memory.posts.find((item) => item.id === id);
  if (!post) {
    throw notFound();
  }
  return post;
}

function contentFields(input: {
  title?: string;
  slug?: string;
  summary?: string;
  tags?: string[];
  seoTitle?: string;
  seoKeywords?: string[];
  bodyHtml?: string;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  if (input.title !== undefined && input.title.trim().length === 0) {
    fields.title = "Title is required.";
  }
  if (input.slug !== undefined) {
    const slug = input.slug.trim();
    if (!slug || !SLUG.test(slug)) {
      fields.slug = "URL slug can use lowercase letters, numbers, and hyphens.";
    }
  }
  if (input.bodyHtml !== undefined && input.bodyHtml.trim().length === 0) {
    fields.bodyHtml = "Write the post before saving.";
  }
  return fields;
}

function assertSlugFree(slug: string, exceptId?: string): void {
  const taken = memory.posts.some((post) => post.slug === slug && post.id !== exceptId);
  if (taken) {
    throw slugTaken();
  }
}

function applyText<T extends { title: string; slug: string; summary: string; tags: string[]; seoTitle: string; seoKeywords: string[]; bodyHtml: string }>(
  target: T,
  input: PatchPostInput,
): void {
  if (input.title !== undefined) {
    target.title = input.title.trim();
  }
  if (input.slug !== undefined) {
    target.slug = input.slug.trim();
  }
  if (input.summary !== undefined) {
    target.summary = input.summary.trim();
  }
  if (input.tags !== undefined) {
    target.tags = input.tags;
  }
  if (input.seoTitle !== undefined) {
    target.seoTitle = input.seoTitle.trim();
  }
  if (input.seoKeywords !== undefined) {
    target.seoKeywords = input.seoKeywords;
  }
  if (input.bodyHtml !== undefined) {
    target.bodyHtml = input.bodyHtml;
  }
}

function viewRevision(post: PostDetail, revision: RevisionDetail): RevisionDetail {
  return clone({
    ...revision,
    liveChangedSinceBase: revision.baseVersion !== post.version,
  });
}

export const mockPostsApi: PostsApi = {
  async listPosts(query?: ListPostsQuery): Promise<PostListResult> {
    let rows = memory.posts.slice();
    if (query?.status) {
      const status: PostStatus = query.status;
      rows = rows.filter((post) => post.status === status);
    }
    if (query?.pending) {
      rows = rows.filter((post) => memory.revisions.has(post.id));
    }
    rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const page = query?.page && query.page > 0 ? query.page : 1;
    const pageSize = query?.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize).map((post) => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      hasPendingRevision: memory.revisions.has(post.id),
      authorName: post.authorName,
      updatedAt: post.updatedAt,
      publishedAt: post.publishedAt,
    }));
    return { items, total: rows.length };
  },

  async getPost(id: string): Promise<PostDetail> {
    return clone(requirePost(id));
  },

  async createPost(input: CreatePostInput): Promise<CreatePostResult> {
    const fields = contentFields({
      title: input.title,
      slug: input.slug,
      summary: input.summary,
      bodyHtml: input.bodyHtml,
    });
    if (!input.title.trim()) {
      fields.title = "Title is required.";
    }
    if (!input.bodyHtml.trim()) {
      fields.bodyHtml = "Write the post before saving.";
    }
    if (Object.keys(fields).length > 0) {
      throw validation(fields);
    }
    const slug = input.slug.trim();
    assertSlugFree(slug);
    const now = new Date().toISOString();
    const post: PostDetail = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      slug,
      summary: input.summary.trim(),
      tags: input.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
      seoTitle: input.seoTitle.trim(),
      seoKeywords: input.seoKeywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0),
      bodyHtml: input.bodyHtml,
      status: "draft",
      authorId: "mock-user",
      authorName: "You",
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      version: "1",
      pendingRevision: null,
    };
    memory.posts.unshift(post);
    return { id: post.id, slug: post.slug };
  },

  async patchPost(id: string, input: PatchPostInput): Promise<PatchPostResult> {
    const post = requirePost(id);
    const problems = contentFields(input);
    if (Object.keys(problems).length > 0) {
      throw validation(problems);
    }
    if (post.status !== "draft" && input.slug !== undefined && input.slug.trim() !== post.slug) {
      throw validation({ slug: "The URL slug is locked once a post is published." });
    }
    if (input.slug !== undefined) {
      assertSlugFree(input.slug.trim(), id);
    }

    const now = new Date().toISOString();
    if (post.status === "published") {
      const existing = memory.revisions.get(id) ?? null;
      const token = existing ? existing.version : post.version;
      if (input.version !== token) {
        throw stale(post);
      }
      const revisionId = existing?.revisionId ?? crypto.randomUUID();
      const revision: RevisionDetail = {
        id: post.id,
        revisionId,
        title: post.title,
        slug: post.slug,
        summary: post.summary,
        tags: post.tags.slice(),
        seoTitle: post.seoTitle,
        seoKeywords: post.seoKeywords.slice(),
        bodyHtml: post.bodyHtml,
        status: post.status,
        authorId: existing?.authorId ?? post.authorId,
        authorName: existing?.authorName ?? post.authorName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        publishedAt: post.publishedAt,
        version: existing ? bump(existing.version) : "1",
        baseVersion: existing?.baseVersion ?? post.version,
        liveChangedSinceBase: false,
      };
      applyText(revision, input);
      memory.revisions.set(id, revision);
      post.pendingRevision = {
        id: revision.revisionId,
        authorName: revision.authorName,
        updatedAt: now,
      };
      return {
        appliedTo: "pendingRevision",
        version: revision.version,
        revisionId: revision.revisionId,
        updatedAt: now,
      };
    }

    if (input.version !== post.version) {
      throw stale(post);
    }
    applyText(post, input);
    post.version = bump(post.version);
    post.updatedAt = now;
    return { appliedTo: "live", version: post.version, updatedAt: now };
  },

  async getRevision(id: string): Promise<RevisionDetail> {
    const post = requirePost(id);
    const revision = memory.revisions.get(id);
    if (!revision) {
      throw notFound("That revision was not found.");
    }
    return viewRevision(post, revision);
  },

  async deleteRevision(id: string, input: RevisionMutationInput): Promise<void> {
    const post = requirePost(id);
    const revision = memory.revisions.get(id);
    if (!revision) {
      throw notFound("That revision was not found.");
    }
    if (input.version !== revision.version) {
      throw stale(post);
    }
    memory.revisions.delete(id);
    post.pendingRevision = null;
  },

  async publishPost(id: string, input: PublishDraftInput): Promise<PublishPostResult> {
    const post = requirePost(id);
    if (post.status === "archived") {
      throw new ApiError({
        status: 409,
        error: "Archived posts cannot be published.",
        code: "archived",
      });
    }
    if (post.status === "published") {
      throw new ApiError({
        status: 409,
        error: "Only a draft can be published.",
        code: "not_draft",
      });
    }
    if (input.version !== post.version) {
      throw stale(post);
    }
    const now = new Date().toISOString();
    post.status = "published";
    post.publishedAt = now;
    post.updatedAt = now;
    post.version = bump(post.version);
    return { version: post.version, publishedAt: now };
  },

  async publishRevision(id: string, input: PublishRevisionInput): Promise<PublishPostResult> {
    const post = requirePost(id);
    if (post.status !== "published") {
      throw new ApiError({
        status: 409,
        error: "Only a published post can publish a revision.",
        code: "not_published",
      });
    }
    const revision = memory.revisions.get(id);
    if (!revision) {
      throw notFound("That revision was not found.");
    }
    if (input.force !== true && (input.version !== revision.version || revision.baseVersion !== post.version)) {
      throw new ApiError({
        status: 409,
        error: "The live post changed after this revision was started.",
        code: "revision_stale",
        currentVersion: post.version,
        updatedAt: post.updatedAt,
        updatedBy: post.authorName,
      });
    }
    post.title = revision.title;
    post.slug = revision.slug;
    post.summary = revision.summary;
    post.tags = revision.tags.slice();
    post.seoTitle = revision.seoTitle;
    post.seoKeywords = revision.seoKeywords.slice();
    post.bodyHtml = revision.bodyHtml;
    memory.revisions.delete(id);
    post.pendingRevision = null;
    const now = new Date().toISOString();
    post.status = "published";
    post.publishedAt = now;
    post.updatedAt = now;
    post.version = bump(post.version);
    return { version: post.version, publishedAt: now };
  },

  async unpublishPost(id: string, input: RevisionMutationInput): Promise<UnpublishPostResult> {
    const post = requirePost(id);
    if (post.status === "archived") {
      throw new ApiError({
        status: 409,
        error: "Archived posts cannot be unpublished.",
        code: "archived",
      });
    }
    if (input.version !== post.version) {
      throw stale(post);
    }
    const now = new Date().toISOString();
    post.status = "draft";
    post.publishedAt = null;
    post.updatedAt = now;
    post.version = bump(post.version);
    return { version: post.version };
  },

  async archivePost(id: string, input: RevisionMutationInput): Promise<void> {
    const post = requirePost(id);
    if (input.version !== post.version) {
      throw stale(post);
    }
    post.status = "archived";
    post.updatedAt = new Date().toISOString();
    post.version = bump(post.version);
  },
};
