import { AuthError } from "@/server/auth-error";
import { requireAdmin } from "@/server/auth";
import { assertSameOrigin, authFailure, json } from "@/server/http";
import { revokeInvite } from "@/server/users";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) {
      throw new AuthError("That invite is no longer pending.", 404);
    }
    await revokeInvite(id);
    return json({ ok: true });
  } catch (error) {
    return authFailure(error);
  }
}
