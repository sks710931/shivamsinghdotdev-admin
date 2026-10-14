import "server-only";

import { AuthError } from "@/server/auth-error";

function blocked(): never {
  throw new AuthError("Cross-site request blocked.", 403, "forbidden");
}

/**
 * Same-origin check for state-changing requests.
 * With APP_ORIGIN set (required in production), `Origin` must equal it exactly; proxy headers are ignored.
 * Without it (local dev only), `Origin` must match the `Host` header. X-Forwarded-Host is never trusted.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) blocked();

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    blocked();
  }

  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    let expected: string;
    try {
      expected = new URL(configured).origin;
    } catch {
      blocked();
    }
    if (parsed.origin !== expected) blocked();
    return;
  }

  if (process.env.NODE_ENV === "production") {
    console.error("APP_ORIGIN is not set; blocking state-changing requests.");
    blocked();
  }
  const host = request.headers.get("host");
  if (!host || parsed.host !== host) blocked();
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
