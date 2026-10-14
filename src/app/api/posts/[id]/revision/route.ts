import { requireUser } from "@/server/auth";
import { apiError, json } from "@/server/http";
import { getPendingRevision } from "@/server/post-revision";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/posts/[id]/revision. 404 when there is no pending revision or a guest asks for another author's post. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return json({ error: "Revision not found.", code: "not_found" }, 404);
    }
    const revision = await getPendingRevision(user, id);
    if (!revision) {
      return json({ error: "Revision not found.", code: "not_found" }, 404);
    }
    return json(revision);
  } catch (error) {
    return apiError(error);
  }
}
