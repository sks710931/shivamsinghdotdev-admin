// @vitest-environment node
import { describe, expect, it } from "vitest";

import * as mod from "@/server/post-publish";
import * as posts from "@/server/posts";
import * as postRevision from "@/server/post-revision";
import * as postUpdate from "@/server/post-update";
import { shouldSkip } from "./require-db-env";

type Actor = { id: string; role: "admin" | "guest" };
type Post = { id: string; slug: string; version: string; title?: string };
type ErrLike = { status?: number; code?: string };

const admin: Actor = { id: String(process.env.TEST_ADMIN_ID ?? ""), role: "admin" };
const guest: Actor = { id: String(process.env.TEST_GUEST_ID ?? ""), role: "guest" };
const otherPostId = String(process.env.TEST_OTHER_POST_ID ?? "");
const missingPostId = "00000000-0000-0000-0000-000000000000";

function readError(value: unknown): ErrLike {
  if (typeof value !== "object" || value === null) return {};
  const record = value as { status?: unknown; code?: unknown };
  return {
    status: typeof record.status === "number" ? record.status : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
  };
}

async function createPublishedPost(actor: Actor): Promise<string> {
  const created = (await posts.createPost(actor, {
    title: `Publish workflow ${actor.role}`,
    slug: `publish-workflow-${actor.role}-${crypto.randomUUID()}`,
    bodyHtml: "<p>body</p>",
  })) as Post;
  const id = created.id;
  const post = (await posts.getPostById(admin, id)) as Post;
  await mod.publishPost(admin, id, { version: post.version });
  return id;
}

async function setupGuestPendingRevision(): Promise<{ id: string; revVersion: string }> {
  await createPublishedPost(admin);
  const id = await createPublishedPost(guest);
  const post = (await posts.getPostById(admin, id)) as Post;
  await postUpdate.updatePost(guest, id, { title: "rev", version: post.version });
  const pending = (await postRevision.getPendingRevision(admin, id)) as Post;
  return { id, revVersion: pending.version };
}

const actions = [
  "publishPost",
  "unpublishPost",
  "archivePost",
  "publishRevision",
  "discardRevision",
] as const;

describe.skipIf(shouldSkip)("post publish workflow", () => {
  for (const name of actions) {
    it(
      `${name} rejects a guest with 403 for another post and a missing post`,
      async () => {
        const statuses: Array<number | undefined> = [];
        for (const postId of [otherPostId, missingPostId]) {
          try {
            await mod[name](guest, postId, {});
            statuses.push(undefined);
          } catch (error) {
            statuses.push(readError(error).status);
          }
        }
        expect(statuses[0]).toBe(403);
        expect(statuses[1]).toBe(statuses[0]);
      },
    );
  }

  it("publishPost on an already published post returns 409 not_draft", async () => {
    const id = await createPublishedPost(admin);
    const cur = (await posts.getPostById(admin, id)) as Post;
    let status: number | undefined;
    let code: string | undefined;
    try {
      await mod.publishPost(admin, id, { version: cur.version });
    } catch (error) {
      const err = readError(error);
      status = err.status;
      code = err.code;
    }
    expect(status).toBe(409);
    expect(code).toBe("not_draft");
  });

  it("old revision cannot be published after unpublish", async () => {
    const { id, revVersion } = await setupGuestPendingRevision();
    const cur = (await posts.getPostById(admin, id)) as Post;
    await mod.unpublishPost(admin, id, { version: cur.version });
    let status: number | undefined;
    try {
      await mod.publishRevision(admin, id, { version: revVersion });
    } catch (error) {
      status = readError(error).status;
    }
    expect([404, 409]).toContain(status);
  });

  it("old revision cannot be published after archive", async () => {
    const { id, revVersion } = await setupGuestPendingRevision();
    const cur = (await posts.getPostById(admin, id)) as Post;
    await mod.archivePost(admin, id, { version: cur.version });
    let status: number | undefined;
    try {
      await mod.publishRevision(admin, id, { version: revVersion });
    } catch (error) {
      status = readError(error).status;
    }
    expect([404, 409]).toContain(status);
  });

  it("archived post + force returns 409 archived", async () => {
    const { id, revVersion } = await setupGuestPendingRevision();
    const cur = (await posts.getPostById(admin, id)) as Post;
    await mod.archivePost(admin, id, { version: cur.version });
    let status: number | undefined;
    let code: string | undefined;
    try {
      await mod.publishRevision(admin, id, { version: revVersion, force: true });
    } catch (error) {
      const parsed = readError(error);
      status = parsed.status;
      code = parsed.code;
    }
    expect(status).toBe(409);
    expect(code).toBe("archived");
  });

  it("publishRevision with wrong version returns 409 stale_version", async () => {
    const { id } = await setupGuestPendingRevision();
    let status: number | undefined;
    let code: string | undefined;
    try {
      await mod.publishRevision(admin, id, { version: Buffer.alloc(8).toString("base64") });
    } catch (error) {
      const err = readError(error);
      status = err.status;
      code = err.code;
    }
    expect(status).toBe(409);
    expect(code).toBe("stale_version");
  });

  it("publishRevision succeeds with the revision version", async () => {
    const { id, revVersion } = await setupGuestPendingRevision();
    const published = await mod.publishRevision(admin, id, { version: revVersion });
    expect(published).toBeTruthy();
    expect(published.title).toBe("rev");
  });
});
