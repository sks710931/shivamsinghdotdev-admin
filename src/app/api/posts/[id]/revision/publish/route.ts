import { requireUser } from "@/server/auth";
import { AuthError } from "@/server/auth-error";
import { apiError, json } from "@/server/http";
import { publishRevision } from "@/server/post-publish";

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

/** POST /api/posts/[id]/revision/publish (contract v1.2, ADR-0004). Admin only; the role is checked before any lookup. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return json(await publishRevision(user, id, await readJson(request)));
  } catch (error) {
    return apiError(error);
  }
}
