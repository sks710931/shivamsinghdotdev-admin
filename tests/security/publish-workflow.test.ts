// @vitest-environment node
import { describe, expect, it } from "vitest";

const m = "@/server/post-publish";
const mod = await import(/* @vite-ignore */ m).catch(() => null);

const guest = { id: String(process.env.TEST_GUEST_ID ?? ""), role: "guest" as const };
const otherPostId = String(process.env.TEST_OTHER_POST_ID ?? "");
const missingPostId = "00000000-0000-0000-0000-000000000000";

function readError(value: unknown): { status?: number } {
  if (typeof value !== "object" || value === null) return {};
  const record = value as { status?: unknown };
  return {
    status: typeof record.status === "number" ? record.status : undefined,
  };
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

  it.todo("old revision cannot be published after unpublish");
  it.todo("old revision cannot be published after archive");
  it.todo("archived post + force returns 409 archived");
});
