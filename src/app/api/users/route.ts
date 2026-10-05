import { requireAdmin } from "@/server/auth";
import { authFailure, json } from "@/server/http";
import { listDirectory } from "@/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    return json(await listDirectory());
  } catch (error) {
    return authFailure(error);
  }
}
