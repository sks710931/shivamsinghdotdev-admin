import { requireUser } from "@/server/auth";
import { AuthError } from "@/server/auth-error";
import { authFailure, json } from "@/server/http";
import { getPostById } from "@/server/posts";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return json({ error: "Post not found.", code: "not_found" }, 404);
    }
    const post = await getPostById(id);
    if (!post) {
      return json({ error: "Post not found.", code: "not_found" }, 404);
    }
    return json(post);
  } catch (error) {
    if (error instanceof AuthError) {
      const code = error.status === 401 ? "unauthorized" : error.status === 403 ? "forbidden" : "error";
      return json({ error: error.message, code }, error.status);
    }
    return authFailure(error);
  }
}
