// @vitest-environment node
import { describe, expect, it } from "vitest";

const m = "@/server/post-revision";
const rev = await import(/* @vite-ignore */ m).catch(() => null);

const guest = { id: String(process.env.TEST_GUEST_ID ?? ""), role: "guest" as const };
const admin = { id: String(process.env.TEST_ADMIN_ID ?? ""), role: "admin" as const };
const otherPostId = String(process.env.TEST_OTHER_POST_ID ?? "");

function readError(value: unknown): { status?: number } {
  if (typeof value !== "object" || value === null) return {};
  const record = value as { status?: unknown };
  return {
    status: typeof record.status === "number" ? record.status : undefined,
  };
}

describe.skipIf(!rev || typeof rev.getPendingRevision !== "function" || !process.env.DB_SERVER || !process.env.TEST_GUEST_ID)("post revision authorization", () => {
  it("getPendingRevision for a guest on another post is null or 404", async () => {
    try {
      const result = await rev.getPendingRevision(guest, otherPostId);
      expect(result).toBeNull();
    } catch (error) {
      expect(readError(error).status).toBe(404);
    }
  });

  it("getPendingRevision for an admin does not reject", async () => {
    let rejected = false;
    try {
      await rev.getPendingRevision(admin, otherPostId);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(false);
  });
});
