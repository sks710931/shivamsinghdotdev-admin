import { mockPostsApi } from "@/lib/posts-client.mock";

export type PostStatus = "draft" | "published" | "archived";

export type PostListItem = {
  id: string;
  title: string;
  slug: string;
  status: PostStatus;
  hasPendingRevision: boolean;
  authorName: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type PostListResult = {
  items: PostListItem[];
  total: number;
};

export type ListPostsQuery = {
  status?: PostStatus;
  pending?: boolean;
  page?: number;
  pageSize?: number;
};

export type PendingRevisionSummary = {
  id: string;
  authorName: string;
  updatedAt: string;
};

export type PostDetail = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  tags: string[];
  seoTitle: string;
  seoKeywords: string[];
  bodyHtml: string;
  status: PostStatus;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  version: string;
  pendingRevision: PendingRevisionSummary | null;
};

/**
 * GET /api/posts/[id]/revision returns the post shape plus revision fields.
 * `version` is the revision token. `baseVersion` is the live version the
 * revision was based on. publishRevision sends this revision token.
 */
export type RevisionDetail = {
  id: string;
  revisionId: string;
  title: string;
  slug: string;
  summary: string;
  tags: string[];
  seoTitle: string;
  seoKeywords: string[];
  bodyHtml: string;
  status: PostStatus;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  version: string;
  baseVersion: string;
  liveChangedSinceBase: boolean;
};

/**
 * POST /api/posts is the create route that already exists. It is not in the
 * slice-1 contract. Tags and SEO keywords stay comma-separated strings, which
 * is the shape that route stores today. It does not return a version token.
 */
export type CreatePostInput = {
  title: string;
  slug: string;
  summary: string;
  tags: string;
  seoKeywords: string;
  seoTitle: string;
  bodyHtml: string;
};

export type CreatePostResult = {
  id: string;
  slug: string;
};

/**
 * PATCH version is the live BlogPost token for a draft (and for the first
 * save of a published post, which creates the revision). Once a pending
 * revision exists, later saves send the revision token from GET revision or
 * from the previous PATCH result. publishPost checks the live token.
 * publishRevision checks the revision token.
 */
export type PatchPostInput = {
  version: string;
  title?: string;
  slug?: string;
  summary?: string;
  tags?: string[];
  seoTitle?: string;
  seoKeywords?: string[];
  bodyHtml?: string;
};

export type PatchPostResult = {
  appliedTo: "live" | "pendingRevision";
  version: string;
  revisionId?: string;
  updatedAt: string;
};

/**
 * POST /api/posts/{id}/publish publishes a draft. `version` is the live token.
 * Draft publish does not accept `force`.
 * POST /api/posts/{id}/revision/publish publishes the pending revision.
 * `version` there is the revision token, and `force` is optional.
 * Both return PublishPostResult.
 */
export type PublishDraftInput = {
  version: string;
};

export type PublishRevisionInput = {
  version: string;
  force?: boolean;
};

export type PublishPostResult = {
  version: string;
  publishedAt: string;
};

export type UnpublishPostResult = {
  version: string;
};

export type RevisionMutationInput = {
  version: string;
};

export const API_ERROR_CODES = [
  "validation",
  "forbidden",
  "not_found",
  "stale_version",
  "slug_taken",
  "revision_stale",
  "archived",
  "not_draft",
  "not_published",
  "unknown",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly code: ApiErrorCode;
  readonly fields?: Record<string, string>;
  readonly currentVersion?: string;
  readonly updatedAt?: string;
  readonly updatedBy?: string;

  constructor(init: {
    status: number;
    error: string;
    code: ApiErrorCode;
    fields?: Record<string, string>;
    currentVersion?: string;
    updatedAt?: string;
    updatedBy?: string;
  }) {
    super(init.error);
    this.name = "ApiError";
    this.status = init.status;
    this.error = init.error;
    this.code = init.code;
    if (init.fields) {
      this.fields = init.fields;
    }
    if (init.currentVersion) {
      this.currentVersion = init.currentVersion;
    }
    if (init.updatedAt) {
      this.updatedAt = init.updatedAt;
    }
    if (init.updatedBy) {
      this.updatedBy = init.updatedBy;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiErrorCode(value: string): value is ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function readFields(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.length > 0) {
      fields[key] = item;
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function defaultMessage(status: number): string {
  if (status === 400) {
    return "Check the highlighted fields.";
  }
  if (status === 403) {
    return "You do not have permission to do that.";
  }
  if (status === 404) {
    return "That post was not found.";
  }
  if (status === 409) {
    return "The post could not be saved because it conflicts with a newer change.";
  }
  return "The request could not be completed.";
}

function inferCode(status: number, body: Record<string, unknown>): ApiErrorCode {
  const declared = body.code;
  if (typeof declared === "string" && isApiErrorCode(declared)) {
    return declared;
  }
  if (status === 400) {
    return "validation";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    if (typeof body.error === "string" && /slug/i.test(body.error)) {
      return "slug_taken";
    }
    if (readString(body.currentVersion)) {
      return "stale_version";
    }
  }
  return "unknown";
}

/**
 * Maps an HTTP status plus a parsed JSON body to ApiError.
 * Pure: it does not read the network. Pass `{ status }` from a Response.
 */
export function apiErrorFromResponse(response: { status: number }, body: unknown): ApiError {
  const record = isRecord(body) ? body : {};
  const message = typeof record.error === "string" && record.error.trim() ? record.error : defaultMessage(response.status);
  const fields = readFields(record.fields);
  return new ApiError({
    status: response.status,
    error: message,
    code: inferCode(response.status, record),
    ...(fields ? { fields } : {}),
    ...(readString(record.currentVersion) ? { currentVersion: readString(record.currentVersion) } : {}),
    ...(readString(record.updatedAt) ? { updatedAt: readString(record.updatedAt) } : {}),
    ...(typeof record.updatedBy === "string" && record.updatedBy ? { updatedBy: record.updatedBy } : {}),
  });
}

function expectString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function parsePostStatus(value: unknown): PostStatus {
  if (value === "published" || value === "archived" || value === "draft") {
    return value;
  }
  return "draft";
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function parseNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parsePending(value: unknown): PendingRevisionSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }
  return {
    id: value.id,
    authorName: expectString(value.authorName),
    updatedAt: expectString(value.updatedAt),
  };
}

function parseListItem(value: unknown): PostListItem | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }
  return {
    id: value.id,
    title: expectString(value.title),
    slug: expectString(value.slug),
    status: parsePostStatus(value.status),
    hasPendingRevision: value.hasPendingRevision === true,
    authorName: expectString(value.authorName),
    updatedAt: expectString(value.updatedAt),
    publishedAt: parseNullableString(value.publishedAt),
  };
}

function pageBounds(query: ListPostsQuery | undefined, total: number): { start: number; end: number } {
  const page = query?.page && query.page > 0 ? query.page : 1;
  const pageSize = query?.pageSize && query.pageSize > 0 ? query.pageSize : 20;
  const start = (page - 1) * pageSize;
  return { start, end: Math.min(total, start + pageSize) };
}

/**
 * Accepts the slice-1 list object. Also accepts today's GET /api/posts, which
 * returns a bare array and has no hasPendingRevision. Array responses are
 * filtered here because that route ignores the query string.
 */
export function parsePostList(body: unknown, query?: ListPostsQuery): PostListResult {
  if (Array.isArray(body)) {
    let items = body.map(parseListItem).filter((item): item is PostListItem => item !== null);
    if (query?.status) {
      const status = query.status;
      items = items.filter((item) => item.status === status);
    }
    if (query?.pending) {
      items = items.filter((item) => item.hasPendingRevision);
    }
    const bounds = pageBounds(query, items.length);
    return { items: items.slice(bounds.start, bounds.end), total: items.length };
  }

  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected list.",
      code: "unknown",
    });
  }

  const items = body.items.map(parseListItem).filter((item): item is PostListItem => item !== null);
  const total = typeof body.total === "number" && Number.isFinite(body.total) ? body.total : items.length;
  return { items, total };
}

export function parsePostDetail(body: unknown): PostDetail {
  if (!isRecord(body) || typeof body.id !== "string" || body.id.length === 0) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected post.",
      code: "unknown",
    });
  }
  return {
    id: body.id,
    title: expectString(body.title),
    slug: expectString(body.slug),
    summary: expectString(body.summary),
    tags: parseStringArray(body.tags),
    seoTitle: expectString(body.seoTitle),
    seoKeywords: parseStringArray(body.seoKeywords),
    bodyHtml: expectString(body.bodyHtml),
    status: parsePostStatus(body.status),
    authorId: expectString(body.authorId),
    authorName: expectString(body.authorName),
    createdAt: expectString(body.createdAt),
    updatedAt: expectString(body.updatedAt),
    publishedAt: parseNullableString(body.publishedAt),
    version: readString(body.version) ?? "",
    pendingRevision: parsePending(body.pendingRevision),
  };
}

export function parseRevisionDetail(body: unknown): RevisionDetail {
  if (!isRecord(body)) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected revision.",
      code: "unknown",
    });
  }
  const post = parsePostDetail(body);
  return {
    id: post.id,
    revisionId: expectString(body.revisionId),
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    tags: post.tags,
    seoTitle: post.seoTitle,
    seoKeywords: post.seoKeywords,
    bodyHtml: post.bodyHtml,
    status: post.status,
    authorId: post.authorId,
    authorName: post.authorName,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt,
    version: readString(body.version) ?? post.version,
    baseVersion: readString(body.baseVersion) ?? "",
    liveChangedSinceBase: body.liveChangedSinceBase === true,
  };
}

function parseCreated(body: unknown): CreatePostResult {
  if (!isRecord(body) || typeof body.id !== "string" || typeof body.slug !== "string") {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected post.",
      code: "unknown",
    });
  }
  return { id: body.id, slug: body.slug };
}

function parsePatch(body: unknown): PatchPostResult {
  if (!isRecord(body) || (body.appliedTo !== "live" && body.appliedTo !== "pendingRevision")) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected save result.",
      code: "unknown",
    });
  }
  const version = readString(body.version);
  const updatedAt = readString(body.updatedAt);
  if (!version || !updatedAt) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected save result.",
      code: "unknown",
    });
  }
  const revisionId = typeof body.revisionId === "string" && body.revisionId ? body.revisionId : undefined;
  return {
    appliedTo: body.appliedTo,
    version,
    updatedAt,
    ...(revisionId ? { revisionId } : {}),
  };
}

function parsePublish(body: unknown): PublishPostResult {
  if (!isRecord(body)) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected publish result.",
      code: "unknown",
    });
  }
  const version = readString(body.version);
  const publishedAt = readString(body.publishedAt);
  if (!version || !publishedAt) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected publish result.",
      code: "unknown",
    });
  }
  return { version, publishedAt };
}

function parseUnpublish(body: unknown): UnpublishPostResult {
  if (!isRecord(body) || !readString(body.version)) {
    throw new ApiError({
      status: 500,
      error: "The server returned an unexpected unpublish result.",
      code: "unknown",
    });
  }
  return { version: readString(body.version) ?? "" };
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function request(path: string, init?: RequestInit): Promise<{ response: Response; body: unknown }> {
  const headers = new Headers(init?.headers);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  const body = await readBody(response);
  if (!response.ok) {
    throw apiErrorFromResponse(response, body);
  }
  return { response, body };
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(payload),
  };
}

function listPath(query?: ListPostsQuery): string {
  const params = new URLSearchParams();
  if (query?.status) {
    params.set("status", query.status);
  }
  if (query?.pending) {
    params.set("pending", "true");
  }
  params.set("page", String(query?.page && query.page > 0 ? query.page : 1));
  params.set("pageSize", String(query?.pageSize && query.pageSize > 0 ? query.pageSize : 20));
  return `/api/posts?${params.toString()}`;
}

export interface PostsApi {
  listPosts(query?: ListPostsQuery): Promise<PostListResult>;
  getPost(id: string): Promise<PostDetail>;
  createPost(input: CreatePostInput): Promise<CreatePostResult>;
  patchPost(id: string, input: PatchPostInput): Promise<PatchPostResult>;
  getRevision(id: string): Promise<RevisionDetail>;
  deleteRevision(id: string, input: RevisionMutationInput): Promise<void>;
  publishPost(id: string, input: PublishDraftInput): Promise<PublishPostResult>;
  publishRevision(id: string, input: PublishRevisionInput): Promise<PublishPostResult>;
  unpublishPost(id: string, input: RevisionMutationInput): Promise<UnpublishPostResult>;
  archivePost(id: string, input: RevisionMutationInput): Promise<void>;
}

export const httpPostsApi: PostsApi = {
  async listPosts(query) {
    const { body } = await request(listPath(query));
    return parsePostList(body, query);
  },
  async getPost(id) {
    const { body } = await request(`/api/posts/${encodeURIComponent(id)}`);
    return parsePostDetail(body);
  },
  async createPost(input) {
    const { body } = await request("/api/posts", jsonInit("POST", input));
    return parseCreated(body);
  },
  async patchPost(id, input) {
    const { body } = await request(`/api/posts/${encodeURIComponent(id)}`, jsonInit("PATCH", input));
    return parsePatch(body);
  },
  async getRevision(id) {
    const { body } = await request(`/api/posts/${encodeURIComponent(id)}/revision`);
    return parseRevisionDetail(body);
  },
  async deleteRevision(id, input) {
    await request(`/api/posts/${encodeURIComponent(id)}/revision`, jsonInit("DELETE", input));
  },
  async publishPost(id: string, input: PublishDraftInput) {
    const { body } = await request(`/api/posts/${encodeURIComponent(id)}/publish`, jsonInit("POST", input));
    return parsePublish(body);
  },
  async publishRevision(id: string, input: PublishRevisionInput) {
    const { body } = await request(
      `/api/posts/${encodeURIComponent(id)}/revision/publish`,
      jsonInit("POST", input),
    );
    return parsePublish(body);
  },
  async unpublishPost(id, input) {
    const { body } = await request(`/api/posts/${encodeURIComponent(id)}/unpublish`, jsonInit("POST", input));
    return parseUnpublish(body);
  },
  async archivePost(id, input) {
    await request(`/api/posts/${encodeURIComponent(id)}/archive`, jsonInit("POST", input));
  },
};

/**
 * Swap point: set NEXT_PUBLIC_POSTS_API_MOCK=1 to use the in-memory mock in
 * src/lib/posts-client.mock.ts. The mock covers every slice-1 route, including
 * list, because live GET /api/posts does not return hasPendingRevision yet.
 * Leave the variable unset to call /api/posts over HTTP.
 */
export function getPostsApi(): PostsApi {
  if (process.env.NEXT_PUBLIC_POSTS_API_MOCK === "1") {
    return mockPostsApi;
  }
  return httpPostsApi;
}
