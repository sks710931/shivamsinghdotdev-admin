import { requireUser } from "@/server/auth";
import { AuthError } from "@/server/auth-error";
import { apiError, assertSameOrigin, json } from "@/server/http";
import { unpublishPost } from "@/server/post-publish";

export const runtime = "nodejs";

async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new AuthError("Expected JSON.", 415);
  }
  const raw = await request.text();
  if (raw.length > 10_000) throw new AuthError("Request is too large.", 413);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AuthError("Expected JSON.", 400, "validation");
  }
}

/** POST /api/posts/[id]/unpublish (contract v1.2, ADR-0004). Admin only; the role is checked before any lookup. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let postId: string | undefined;
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    postId = id;
    return json(await unpublishPost(user, id, await readJson(request)));
  } catch (error) {
    return apiError(error, { route: "/api/posts/[id]/unpublish", postId });
  }
}
