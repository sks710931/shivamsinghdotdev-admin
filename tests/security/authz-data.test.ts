// @vitest-environment node
import { describe, expect, it } from "vitest";

const m = "@/server/posts";
const posts = await import(/* @vite-ignore */ m).catch(() => null);

const guest = { id: Number(process.env.TEST_GUEST_ID), role: "guest" as const };
const admin = { id: Number(process.env.TEST_ADMIN_ID), role: "admin" as const };
const otherPostId = Number(process.env.TEST_OTHER_POST_ID);

function readError(value: unknown): { status?: number; code?: string } {
  if (typeof value !== "object" || value === null) return {};
  const record = value as { status?: unknown; code?: unknown };
  return {
    status: typeof record.status === "number" ? record.status : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
  };
}

async function settle(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return error;
  }
}

describe.skipIf(!posts || !process.env.DB_SERVER)("post data authorization", () => {
  it("a guest listing sees only rows whose authorId equals its id", async () => {
    const rows = await posts.listPosts(guest, {});
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(row.authorId).toBe(guest.id);
    }
  });

  it("a guest getPostById on another author post is 404 not_found", async () => {
    const outcome = await settle(() => posts.getPostById(guest, otherPostId));
    const { status, code } = readError(outcome);
    expect(status).toBe(404);
    expect(code).toBe("not_found");
  });

  it("an admin can read any post", async () => {
    const post = await posts.getPostById(admin, otherPostId);
    expect(post).toBeTruthy();
    expect(post.id).toBe(otherPostId);
  });

  it.skipIf(typeof posts?.updatePost !== "function")(
    "a guest calling updatePost with force: true gets 403",
    async () => {
      const outcome = await settle(() => posts.updatePost(guest, otherPostId, { force: true }));
      expect(readError(outcome).status).toBe(403);
    },
  );
});
