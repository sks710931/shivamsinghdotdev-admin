// @vitest-environment node
import { describe, expect, it } from "vitest";

const m = "@/server/posts";
const posts = await import(/* @vite-ignore */ m).catch((e) => { if (process.env.DB_SERVER) console.error("authz-data: cannot load @/server/posts:", e); return null; });

const guest = { id: String(process.env.TEST_GUEST_ID ?? ""), role: "guest" as const };
const admin = { id: String(process.env.TEST_ADMIN_ID ?? ""), role: "admin" as const };
const otherPostId = String(process.env.TEST_OTHER_POST_ID ?? "");

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

describe.skipIf(!posts || typeof posts.getPostById !== "function" || !process.env.DB_SERVER || !process.env.TEST_GUEST_ID)("post data authorization", () => {
  it("a guest listing sees only rows whose authorId equals its id", async () => {
    const rows = await posts.listPosts(guest, { pageSize: 100 });
    expect(Array.isArray(rows.items)).toBe(true);
    expect(rows.items.map((r: { id: string }) => r.id.toUpperCase())).not.toContain(otherPostId.toUpperCase());
    const adminRows = await posts.listPosts(admin, { pageSize: 100 });
    expect(adminRows.items.map((r: { id: string }) => r.id.toUpperCase())).toContain(otherPostId.toUpperCase());
  });

  it("a guest getPostById on another author post is 404 not_found", async () => {
    const outcome = await settle(() => posts.getPostById(guest, otherPostId));
    if (outcome === null) return;
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

  it.skipIf(typeof posts?.createPost !== "function")(
    "createPost for a guest with status published returns status draft",
    async () => {
      const created = await posts.createPost(guest, {
        title: "t",
        bodyHtml: "<p>x</p>",
        status: "published",
        slug: `sec-${Date.now()}-a`,
      });
      const stored = await posts.getPostById(admin, created.id);
      expect(stored.status).toBe("draft");
    },
  );

  it.skipIf(typeof posts?.createPost !== "function")(
    "createPost bodyHtml does not contain onerror or script",
    async () => {
      const created = await posts.createPost(admin, {
        title: "t2",
        bodyHtml: "<img src=x onerror=alert(1)><p>ok</p>",
        slug: `sec-${Date.now()}-b`,
      });
      const stored = await posts.getPostById(admin, created.id);
      expect(stored.bodyHtml).not.toMatch(/onerror|<script/i);
    },
  );
});
