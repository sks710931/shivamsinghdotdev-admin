import { requireUser } from "@/server/auth";
import { AuthError } from "@/server/auth-error";
import { apiError, json } from "@/server/http";
import { updatePost } from "@/server/post-update";
import { getPostById } from "@/server/posts";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return json({ error: "Post not found.", code: "not_found" }, 404);
    }
    const post = await getPostById(user, id);
    if (!post) {
      return json({ error: "Post not found.", code: "not_found" }, 404);
    }
    return json(post);
  } catch (error) {
    return apiError(error);
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new AuthError("Expected JSON.", 415);
  }
  const raw = await request.text();
  if (raw.length > 250_000) throw new AuthError("Request is too large.", 413);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AuthError("Expected JSON.", 400, "validation");
  }
}

/** PATCH /api/posts/[id]. Drafts update in place; live posts update the single pending revision. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return json({ error: "Post not found.", code: "not_found" }, 404);
    }
    return json(await updatePost(user, id, await readJson(request)));
  } catch (error) {
    return apiError(error);
  }
}
