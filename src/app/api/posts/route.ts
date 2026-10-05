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

export async function GET() {
  try {
    await requireUser();
    return json(await listPosts());
  } catch (error) {
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
