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

    const response = apiError(sensitiveError, {
      route: "/api/posts/[id]/archive",
      postId: "22222222-2222-4222-8222-222222222222",
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(" ");
    expect(loggedArgs).not.toContain(secret);
    expect(loggedArgs).not.toContain("Connection failed");
    expect(loggedArgs).toContain("[route=/api/posts/[id]/archive postId=22222222-2222-4222-8222-222222222222]");
    expect(loggedArgs).toContain("Error");

    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("logs postId=invalid and produces no \\r or \\n when postId contains decoded newline (\\n)", () => {
    const error = new Error("Something broke");
    const maliciousPostId = decodeURIComponent("abc%0Afake");
    apiError(error, { route: "/api/posts/[id]", postId: maliciousPostId });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(" ");
    expect(loggedArgs).toContain("postId=invalid");
    expect(loggedArgs).not.toContain("fake");
    expect(loggedArgs).not.toMatch(/[\r\n]/);
  });

  it("logs postId=invalid and produces no \\r or \\n when postId contains valid UUID followed by CRLF and fake log text", () => {
    const error = new Error("Something broke");
    const maliciousPostId = decodeURIComponent(
      "11111111-1111-4111-8111-111111111111%0D%0A[api] Fake log text",
    );
    apiError(error, { route: "/api/posts/[id]", postId: maliciousPostId });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(" ");
    expect(loggedArgs).toContain("postId=invalid");
    expect(loggedArgs).not.toContain("Fake log text");
    expect(loggedArgs).not.toMatch(/[\r\n]/);
  });

  it("logs postId=invalid for a non-UUID value", () => {
    const error = new Error("Something broke");
    apiError(error, { route: "/api/posts/[id]", postId: "not-a-valid-uuid" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "API request failed",
      "[route=/api/posts/[id] postId=invalid]",
      "Error",
    );
  });

  it("logs a valid UUID as-is", () => {
    const error = new Error("Something broke");
    const validUuid = "33333333-3333-4333-8333-333333333333";
    apiError(error, { route: "/api/posts/[id]", postId: validUuid });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "API request failed",
      `[route=/api/posts/[id] postId=${validUuid}]`,
      "Error",
    );
  });

  it("sanitizes route with line breaks so logged output contains no \\r or \\n", () => {
    const error = new Error("Something broke");
    apiError(error, { route: "/api/posts\r\n[id]\narchive" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(" ");
    expect(loggedArgs).not.toMatch(/[\r\n]/);
    expect(consoleSpy).toHaveBeenCalledWith(
      "API request failed",
      "[route=/api/posts__[id]_archive]",
      "Error",
    );
  });

  it("keeps response body unchanged when error is logged with sanitized route and invalid postId", async () => {
    const error = new Error("Something broke");
    const response = apiError(error, {
      route: "/api/posts\r\n[id]",
      postId: decodeURIComponent("11111111-1111-4111-8111-111111111111%0D%0Afake"),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "Unable to complete the request.",
      code: "internal",
    });
  });

  it("does not log non-AuthError internal 500 when error is AuthError", () => {
    const authError = new AuthError("Unauthorized access.", 401, "unauthorized");
    const response = apiError(authError, { route: "/api/posts" });

    expect(response.status).toBe(401);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("buildSafeTag", () => {
  it("formats both route and postId when valid UUID is provided", () => {
    expect(
      buildSafeTag({
        route: "/api/posts/[id]",
        postId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("[route=/api/posts/[id] postId=11111111-1111-4111-8111-111111111111]");
  });

  it("formats only route", () => {
    expect(buildSafeTag({ route: "/api/posts" })).toBe("[route=/api/posts]");
  });

  it("formats only postId when valid UUID is provided", () => {
    expect(buildSafeTag({ postId: "11111111-1111-4111-8111-111111111111" })).toBe(
      "[postId=11111111-1111-4111-8111-111111111111]",
    );
  });

  it("logs valid UUID as-is (case-insensitive)", () => {
    expect(buildSafeTag({ postId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE" })).toBe(
      "[postId=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE]",
    );
  });

  it("formats non-UUID postId as postId=invalid", () => {
    expect(buildSafeTag({ postId: "p-1" })).toBe("[postId=invalid]");
    expect(buildSafeTag({ postId: "not-a-uuid" })).toBe("[postId=invalid]");
    expect(buildSafeTag({ postId: "" })).toBe("[postId=invalid]");
    expect(buildSafeTag({ route: "/api/posts/[id]", postId: "post-123" })).toBe(
      "[route=/api/posts/[id] postId=invalid]",
    );
  });

  it("formats postId containing decoded '\\n' and '\\r\\n' as postId=invalid and output has no \\r or \\n", () => {
    const newlineTag = buildSafeTag({ postId: decodeURIComponent("abc%0Afake") });
    expect(newlineTag).toBe("[postId=invalid]");
    expect(newlineTag).not.toMatch(/[\r\n]/);

    const crlfTag = buildSafeTag({
      postId: decodeURIComponent("11111111-1111-4111-8111-111111111111%0D%0A[api] Fake log text"),
    });
    expect(crlfTag).toBe("[postId=invalid]");
    expect(crlfTag).not.toMatch(/[\r\n]/);
  });

  it("sanitizes route with line breaks and characters outside [A-Za-z0-9/_-[].:]", () => {
    const sanitizedTag = buildSafeTag({ route: "/api/posts\r\n[id]\n" });
    expect(sanitizedTag).toBe("[route=/api/posts__[id]_]");
    expect(sanitizedTag).not.toMatch(/[\r\n]/);

    expect(buildSafeTag({ route: "/api/posts/tag\t name" })).toBe("[route=/api/posts/tag__name]");
    expect(buildSafeTag({ route: "/api/posts/[id]?q=1#top" })).toBe("[route=/api/posts/[id]_q_1_top]");
    expect(buildSafeTag({ route: "/valid-path/123_456.[id]:test" })).toBe(
      "[route=/valid-path/123_456.[id]:test]",
    );
  });

  it("formats empty context as [api]", () => {
    expect(buildSafeTag()).toBe("[api]");
    expect(buildSafeTag({})).toBe("[api]");
  });
});
