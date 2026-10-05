import { assertSameOrigin, authFailure, json, readJson } from "@/server/http";
import { acceptInvite } from "@/server/users";

export const runtime = "nodejs";

type AcceptBody = {
  token?: unknown;
  password?: unknown;
  displayName?: unknown;
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as AcceptBody | null;
    const user = await acceptInvite({
      token: typeof body?.token === "string" ? body.token : "",
      password: typeof body?.password === "string" ? body.password : "",
      displayName: typeof body?.displayName === "string" ? body.displayName : "",
    });
    return json({ user });
  } catch (error) {
    return authFailure(error);
  }
}
