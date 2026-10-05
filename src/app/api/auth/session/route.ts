import { getCurrentUser } from "@/server/auth";
import { authFailure, json } from "@/server/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return json({ user });
  } catch (error) {
    return authFailure(error);
  }
}
