import "server-only";

import { AuthError } from "@/server/auth-error";

function blocked(): never {
  throw new AuthError("Cross-site request blocked.", 403, "forbidden");
}

/**
 * Same-origin check for state-changing requests.
 * `Origin` must equal APP_ORIGIN, or the APP_URL origin when APP_ORIGIN is unset. Production with neither fails closed.
 * Local dev with neither: `Origin` must be http://<Host>. X-Forwarded-Host is never trusted.
 */
let badOriginConfigLogged = false;

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) blocked();

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    blocked();
  }

  // APP_ORIGIN wins; otherwise APP_URL's origin (set in CI, dev-local.sh and on Azure).
  const configured = process.env.APP_ORIGIN?.trim() || process.env.APP_URL?.trim();
  if (configured) {
    let expected: string;
    try {
      expected = new URL(configured).origin;
    } catch {
      if (!badOriginConfigLogged) {
        badOriginConfigLogged = true;
        console.error("APP_ORIGIN/APP_URL is not a valid URL; blocking state-changing requests.");
      }
      blocked();
    }
    if (parsed.origin !== expected) blocked();
    return;
  }

  if (process.env.NODE_ENV === "production") {
    console.error("Neither APP_ORIGIN nor APP_URL is set; blocking state-changing requests.");
    blocked();
  }
  // Local dev only: plain http on the Host header (scheme is checked too).
  const host = request.headers.get("host");
  if (!host || parsed.origin !== `http://${host}`) blocked();
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
    return json({ error: error.message, code: error.code ?? DEFAULT_CODES[error.status] ?? "error" }, error.status);
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

/** Maps an error to the contract response shape. */
export function apiError(error: unknown): Response {
  if (error instanceof AuthError) {
    return json(
      {
        ...error.extra,
        error: error.message,
        code: error.code ?? DEFAULT_CODES[error.status] ?? "error",
      },
      error.status,
    );
  }

  console.error("API request failed", error instanceof Error ? error.name : "error");
  return json({ error: "Unable to complete the request.", code: "internal" }, 500);
}
