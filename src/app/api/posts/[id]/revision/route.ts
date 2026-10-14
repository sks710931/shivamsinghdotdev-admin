import { requireUser } from "@/server/auth";
import { AuthError } from "@/server/auth-error";
import { apiError, json } from "@/server/http";
import { discardRevision } from "@/server/post-publish";
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

/** DELETE /api/posts/[id]/revision: admin only; sets the pending revision aside. Body `{ version }` (revision's). */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      throw new AuthError("Expected JSON.", 415);
    }
    let body: unknown;
    try {
      body = JSON.parse(await request.text()) as unknown;
    } catch {
      throw new AuthError("Expected JSON.", 400, "validation");
    }
    return json(await discardRevision(user, id, body));
  } catch (error) {
    return apiError(error);
  }
}
