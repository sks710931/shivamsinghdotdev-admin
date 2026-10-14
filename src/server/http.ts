import "server-only";

import { AuthError } from "@/server/auth-error";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) {
    throw new AuthError("Cross-site request blocked.", 403);
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AuthError("Cross-site request blocked.", 403);
  }

  if (originHost !== host) {
    throw new AuthError("Cross-site request blocked.", 403);
  }
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim();
  return address || "unknown";
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AuthError("Expected JSON.", 415);
  }

  const raw = await request.text();
  if (raw.length > 10_000) {
    throw new AuthError("Request is too large.", 413);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AuthError("Expected JSON.", 400);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function authFailure(error: unknown): Response {
  if (error instanceof AuthError) {
    return json({ error: error.message }, error.status);
  }

  console.error("Auth request failed", error instanceof Error ? error.name : "error");
  return json({ error: "Unable to complete the request." }, 500);
}

const DEFAULT_CODES: Record<number, string> = {
  400: "validation",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
};

/** Maps an error to the contract v1.1 `{ error, code }` response shape. */
export function apiError(error: unknown): Response {
  if (error instanceof AuthError) {
    return json(
      { error: error.message, code: error.code ?? DEFAULT_CODES[error.status] ?? "error" },
      error.status,
    );
  }

  console.error("API request failed", error instanceof Error ? error.name : "error");
  return json({ error: "Unable to complete the request.", code: "internal" }, 500);
}
