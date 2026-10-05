import { AuthError } from "@/server/auth-error";
import { requireAdmin } from "@/server/auth";
import { assertSameOrigin, authFailure, json, readJson } from "@/server/http";
import { deleteUser, setUserDisabled } from "@/server/users";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function userId(context: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    throw new AuthError("That user was not found.", 404);
  }
  return id;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await userId(context);
    const body = (await readJson(request)) as { disabled?: unknown } | null;
    if (typeof body?.disabled !== "boolean") {
      throw new AuthError("Choose whether the account is disabled.", 400);
    }
    await setUserDisabled(admin.id, id, body.disabled);
    return json({ ok: true });
  } catch (error) {
    return authFailure(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await deleteUser(admin.id, await userId(context));
    return json({ ok: true });
  } catch (error) {
    return authFailure(error);
  }
}
