// @vitest-environment node
import { describe, expect, it } from "vitest";

import * as posts from "@/server/posts";
import * as upd from "@/server/post-update";

const REQUIRED_ENVS = [
  "DB_SERVER",
  "TEST_ADMIN_ID",
  "TEST_GUEST_ID",
  "TEST_OTHER_POST_ID",
] as const;

const missingEnvs = REQUIRED_ENVS.filter((key) => !process.env[key]);
const shouldSkip = missingEnvs.length > 0;

if (process.env.CI && shouldSkip) {
  throw new Error(
    `CI is set but required environment variables are missing: ${missingEnvs.join(", ")}`,
  );
}

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

describe.skipIf(shouldSkip)("post data authorization", () => {
  it("a guest listing sees only rows whose authorId equals its id", async () => {
    const rows = await posts.listPosts(guest, { pageSize: 100 });
    expect(Array.isArray(rows.items)).toBe(true);
    expect(rows.items.map((r: { id: string }) => r.id.toUpperCase())).not.toContain(otherPostId.toUpperCase());
    const adminPost = await posts.getPostById(admin, otherPostId);
    expect(adminPost).not.toBeNull();
    expect(String(adminPost!.id).toUpperCase()).toBe(otherPostId.toUpperCase());
  });

  it("a guest getPostById on another author post or fake id returns null", async () => {
    const post = await posts.getPostById(guest, otherPostId);
    expect(post).toBeNull();
    const fakePost = await posts.getPostById(guest, "00000000-0000-0000-0000-000000000000");
    expect(fakePost).toBeNull();
  });

  it("an admin can read any post", async () => {
    const post = await posts.getPostById(admin, otherPostId);
    expect(post).toBeTruthy();
    expect(post!.id).toBe(otherPostId);
  });

  it("a guest calling updatePost with force: true gets 403", async () => {
    const created = await posts.createPost(guest, {
      title: "f",
      slug: `sec-${Date.now()}-f`,
      bodyHtml: "<p>x</p>",
    });
    const stored = await posts.getPostById(admin, created.id);
    const outcome = await settle(() =>
      upd.updatePost(guest, created.id, { title: "f2", version: stored!.version, force: true }),
    );
    expect(readError(outcome).status).toBe(403);
  });

  it("a guest updatePost on another author post or fake id rejects with 404 not_found", async () => {
    for (const id of [otherPostId, "00000000-0000-0000-0000-000000000000"]) {
      const outcome = await settle(() =>
        upd.updatePost(guest, id, { title: "z", version: "AAAAAAAAAAA=" }),
      );
      const err = readError(outcome);
      expect(err.status).toBe(404);
      expect(err.code).toBe("not_found");
    }
  });

  it("stale PATCH returns 409 stale_version", async () => {
    const created = await posts.createPost(guest, {
      title: "stale test",
      slug: `sec-${Date.now()}-stale`,
      bodyHtml: "<p>body</p>",
    });
    const outcome = await settle(() =>
      upd.updatePost(guest, created.id, {
        title: "stale test updated",
        version: Buffer.alloc(8).toString("base64"),
      }),
    );
    const err = readError(outcome);
    expect(err.status).toBe(409);
    expect(err.code).toBe("stale_version");
  });

  it("createPost for a guest with status published returns status draft", async () => {
    const created = await posts.createPost(guest, {
      title: "t",
      bodyHtml: "<p>x</p>",
      status: "published",
      slug: `sec-${Date.now()}-a`,
    });
    const stored = await posts.getPostById(admin, created.id);
    expect(stored!.status).toBe("draft");
  });

  it("admin create with status published still yields draft", async () => {
    const created = await posts.createPost(admin, {
      title: "admin draft",
      bodyHtml: "<p>body</p>",
      status: "published",
      slug: `sec-${Date.now()}-admin-pub`,
    });
    const stored = await posts.getPostById(admin, created.id);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("draft");
  });

  it("createPost bodyHtml does not contain onerror or script", async () => {
    const created = await posts.createPost(admin, {
      title: "t2",
      bodyHtml: "<img src=x onerror=alert(1)><p>ok</p>",
      slug: `sec-${Date.now()}-b`,
    });
    const stored = await posts.getPostById(admin, created.id);
    expect(stored!.bodyHtml).not.toMatch(/onerror|<script/i);
  });
});
