import { requireUser } from "@/server/auth";
import { AuthError } from "@/server/auth-error";
import { assertSameOrigin, authFailure, json } from "@/server/http";
import { createPost, listPosts } from "@/server/posts";

export const runtime = "nodejs";

async function readPostJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AuthError("Expected JSON.", 415);
  }
  const raw = await request.text();
  if (raw.length > 250_000) {
    throw new AuthError("Request is too large.", 413);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AuthError("Expected JSON.", 400);
  }
}

const LIST_STATUSES = new Set(["draft", "published", "archived"]);
const MAX_PAGE = 1_000_000;
const MAX_PAGE_SIZE = 100;

type ListStatus = "draft" | "published" | "archived";

type ParsedListQuery = {
  status?: ListStatus;
  pending?: boolean;
  page: number;
  pageSize: number;
};

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "validation";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "payload_too_large";
    case 415:
      return "unsupported_media_type";
    case 429:
      return "rate_limited";
    default:
      return "error";
  }
}

function readWholeNumber(
  raw: string | null,
  fallback: number,
  max: number,
  invalidMessage: string,
  tooLargeMessage: string,
  fields: Record<string, string>,
  key: string,
): number {
  if (raw === null) {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    fields[key] = invalidMessage;
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) {
    fields[key] = tooLargeMessage;
    return fallback;
  }
  return value;
}

function parseListQuery(params: URLSearchParams): { ok: true; value: ParsedListQuery } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};

  const statusRaw = params.get("status");
  let status: ListStatus | undefined;
  if (statusRaw !== null) {
    if (LIST_STATUSES.has(statusRaw)) {
      status = statusRaw as ListStatus;
    } else {
      fields.status = "Status must be draft, published, or archived.";
    }
  }

  const pendingRaw = params.get("pending");
  let pending: boolean | undefined;
  if (pendingRaw !== null) {
    const normalized = pendingRaw.toLowerCase();
    if (normalized === "true") {
      pending = true;
    } else if (normalized === "false") {
      pending = false;
    } else {
      fields.pending = "Pending must be true or false.";
    }
  }

  const page = readWholeNumber(
    params.get("page"),
    1,
    MAX_PAGE,
    "Page must be a positive whole number.",
    "Page is too large.",
    fields,
    "page",
  );
  const pageSize = readWholeNumber(
    params.get("pageSize"),
    20,
    MAX_PAGE_SIZE,
    "Page size must be a whole number from 1 to 100.",
    "Page size must be a whole number from 1 to 100.",
    fields,
    "pageSize",
  );

  if (!fields.page && !fields.pageSize && (page - 1) * pageSize > 2_147_483_647) {
    fields.page = "Page is too large.";
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return { ok: true, value: { status, pending, page, pageSize } };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const parsed = parseListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return json(
        { error: "Some fields are invalid.", code: "validation", fields: parsed.fields },
        400,
      );
    }

    const posts = await listPosts({
      status: parsed.value.status,
      pending: parsed.value.pending,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
      authorId: user.role === "guest" ? user.id : undefined,
    });
    return json(posts);
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.status;
      return json({ error: error.message, code: codeForStatus(status) }, status);
    }
    return authFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const created = await createPost(user.id, await readPostJson(request));
    return json(created, 201);
  } catch (error) {
    return authFailure(error);
  }
}
