import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/server/auth-error";
import { apiError, buildSafeTag } from "./http";

describe("apiError", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("returns exactly 500 with internal error code for non-AuthError", async () => {
    const error = new Error("Something broke");
    const response = apiError(error, { route: "/api/posts", postId: "post-123" });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "Unable to complete the request.",
      code: "internal",
    });
  });

  it("includes safe tag with route and postId when both are provided", () => {
    const error = new Error("Something broke");
    apiError(error, { route: "/api/posts/[id]", postId: "11111111-1111-4111-8111-111111111111" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "API request failed",
      "[route=/api/posts/[id] postId=11111111-1111-4111-8111-111111111111]",
      "Error",
    );
  });

  it("includes safe tag with route when only route is provided", () => {
    const error = new TypeError("Cannot read properties of undefined");
    apiError(error, { route: "/api/posts" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "API request failed",
      "[route=/api/posts]",
      "TypeError",
    );
  });

  it("falls back to [api] tag when no context is provided", () => {
    const error = new RangeError("Out of range");
    apiError(error);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "API request failed",
      "[api]",
      "RangeError",
    );
  });

  it("handles non-Error objects and uses fallback error name", () => {
    apiError("string error", { route: "/api/posts" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "API request failed",
      "[route=/api/posts]",
      "error",
    );
  });

  it("never logs error.message, request bodies, or credentials (secrets in message do not appear in log)", async () => {
    const secret = "SUPER_SECRET_DB_PASSWORD_12345!#@";
    const sensitiveError = new Error(`Connection failed with credentials: ${secret}`);

    const response = apiError(sensitiveError, { route: "/api/posts/[id]/archive", postId: "secret-post-id" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(" ");
    expect(loggedArgs).not.toContain(secret);
    expect(loggedArgs).not.toContain("Connection failed");
    expect(loggedArgs).toContain("[route=/api/posts/[id]/archive postId=secret-post-id]");
    expect(loggedArgs).toContain("Error");

    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("does not log non-AuthError internal 500 when error is AuthError", () => {
    const authError = new AuthError("Unauthorized access.", 401, "unauthorized");
    const response = apiError(authError, { route: "/api/posts" });

    expect(response.status).toBe(401);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("buildSafeTag", () => {
  it("formats both route and postId", () => {
    expect(buildSafeTag({ route: "/api/posts/[id]", postId: "p-1" })).toBe("[route=/api/posts/[id] postId=p-1]");
  });

  it("formats only route", () => {
    expect(buildSafeTag({ route: "/api/posts" })).toBe("[route=/api/posts]");
  });

  it("formats only postId", () => {
    expect(buildSafeTag({ postId: "p-1" })).toBe("[postId=p-1]");
  });

  it("formats empty context as [api]", () => {
    expect(buildSafeTag()).toBe("[api]");
    expect(buildSafeTag({})).toBe("[api]");
  });
});
