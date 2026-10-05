import { logout } from "@/server/auth";
import { assertSameOrigin, authFailure, json } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await logout();
    return json({ ok: true });
  } catch (error) {
    return authFailure(error);
  }
}
