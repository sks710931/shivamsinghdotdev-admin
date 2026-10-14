// @vitest-environment node
import { describe, expect, it } from "vitest";

import * as rev from "@/server/post-revision";

import { shouldSkip } from "./require-db-env";

const guest = { id: String(process.env.TEST_GUEST_ID ?? ""), role: "guest" as const };
const admin = { id: String(process.env.TEST_ADMIN_ID ?? ""), role: "admin" as const };
const otherPostId = String(process.env.TEST_OTHER_POST_ID ?? "");

describe.skipIf(shouldSkip)("post revision authorization", () => {
  it("getPendingRevision for a guest on another post or fake id returns null", async () => {
    const result = await rev.getPendingRevision(guest, otherPostId);
    expect(result).toBeNull();
    const fakeResult = await rev.getPendingRevision(guest, "00000000-0000-0000-0000-000000000000");
    expect(fakeResult).toBeNull();
  });

  it("getPendingRevision for an admin does not reject", async () => {
    const result = await rev.getPendingRevision(admin, otherPostId);
    expect(result === null || typeof result === "object").toBe(true);
  });
});
