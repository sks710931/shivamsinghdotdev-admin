// @vitest-environment node
import { describe, expect, it } from "vitest";

const m = "@/server/post-publish";
const mod = await import(/* @vite-ignore */ m).catch(() => null);

const admin = { id: String(process.env.TEST_ADMIN_ID ?? ""), role: "admin" as const };
const guest = { id: String(process.env.TEST_GUEST_ID ?? ""), role: "guest" as const };
const otherPostId = String(process.env.TEST_OTHER_POST_ID ?? "");
const missingPostId = "00000000-0000-0000-0000-000000000000";

function readError(value: unknown): { status?: number; code?: string } {
  if (typeof value !== "object" || value === null) return {};
  const record = value as { status?: unknown; code?: unknown };
  return {
    status: typeof record.status === "number" ? record.status : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
  };
}

const revisionCasesReady = Boolean(
  mod && process.env.DB_SERVER && process.env.TEST_ADMIN_ID && process.env.TEST_GUEST_ID,
);

async function createPublishedPost(actor: { id: string; role: "admin" | "guest" }) {
  const posts = await import("@/server/posts");
  const created = await posts.createPost(actor, {
    title: `Publish workflow ${actor.role}`,
    slug: `publish-workflow-${actor.role}-${crypto.randomUUID()}`,
    bodyHtml: "<p>body</p>",
  });
  const id = created.id as string;
  const version = (await posts.getPostById(admin, id)).version;
  await mod.publishPost(admin, id, { version });
  return id;
}

async function setupGuestPendingRevision() {
  await createPublishedPost(admin);
  const id = await createPublishedPost(guest);
  const posts = await import("@/server/posts");
  const version = (await posts.getPostById(admin, id)).version;
  await (await import("@/server/post-update")).updatePost(guest, id, { title: "rev", version });
  const pending = await (await import("@/server/post-revision")).getPendingRevision(admin, id);
  return { id, revVersion: pending.version as number };
}

const actions = [
  "publishPost",
  "unpublishPost",
  "archivePost",
  "publishRevision",
  "discardRevision",
] as const;

describe.skipIf(!mod || !process.env.DB_SERVER || !process.env.TEST_GUEST_ID)("post publish workflow", () => {
  for (const name of actions) {
    it.skipIf(!mod || typeof mod[name] !== "function")(
      `${name} rejects a guest with 403 for another post and a missing post`,
      async () => {
        const statuses: Array<number | undefined> = [];
        for (const postId of [otherPostId, missingPostId]) {
          try {
            await mod[name](guest, postId);
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

  it.skipIf(!revisionCasesReady)("old revision cannot be published after unpublish", async () => {
    const { id, revVersion } = await setupGuestPendingRevision();
    const posts = await import("@/server/posts");
    const cur = await posts.getPostById(admin, id);
    await mod.unpublishPost(admin, id, { version: cur.version });
    let status: number | undefined;
    try {
      await mod.publishRevision(admin, id, { version: revVersion });
    } catch (error) {
      status = readError(error).status;
    }
    expect([404, 409]).toContain(status);
  });

  it.skipIf(!revisionCasesReady)("old revision cannot be published after archive", async () => {
    const { id, revVersion } = await setupGuestPendingRevision();
    const posts = await import("@/server/posts");
    const cur = await posts.getPostById(admin, id);
    await mod.archivePost(admin, id, { version: cur.version });
    let status: number | undefined;
    try {
      await mod.publishRevision(admin, id, { version: revVersion });
    } catch (error) {
      status = readError(error).status;
    }
    expect([404, 409]).toContain(status);
  });

  it.skipIf(!revisionCasesReady)("archived post + force returns 409 archived", async () => {
    const { id, revVersion } = await setupGuestPendingRevision();
    const posts = await import("@/server/posts");
    const cur = await posts.getPostById(admin, id);
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
});
