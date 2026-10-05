import { requireAdmin } from "@/server/auth";
import { assertSameOrigin, authFailure, json, readJson } from "@/server/http";
import { createInvite } from "@/server/users";

export const runtime = "nodejs";

type InviteBody = {
  email?: unknown;
  displayName?: unknown;
  role?: unknown;
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const body = (await readJson(request)) as InviteBody | null;
    const invite = await createInvite({
      email: typeof body?.email === "string" ? body.email : "",
      displayName: typeof body?.displayName === "string" ? body.displayName : "",
      role: typeof body?.role === "string" ? body.role : "",
      invitedBy: admin.id,
    });
    return json({ invite }, 201);
  } catch (error) {
    return authFailure(error);
  }
}
