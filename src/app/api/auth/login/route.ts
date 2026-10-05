import { login } from "@/server/auth";
import { assertSameOrigin, authFailure, clientAddress, json, readJson } from "@/server/http";

export const runtime = "nodejs";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as LoginBody | null;
    const user = await login({
      email: typeof body?.email === "string" ? body.email : "",
      password: typeof body?.password === "string" ? body.password : "",
      clientKey: clientAddress(request),
    });
    return json({ user });
  } catch (error) {
    return authFailure(error);
  }
}
