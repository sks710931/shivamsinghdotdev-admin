import { requireUser } from "@/server/auth";
import { apiError, json } from "@/server/http";
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
