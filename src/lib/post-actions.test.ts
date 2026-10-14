import { describe, expect, it } from "vitest";

import { getPostActions } from "@/lib/post-actions";

describe("getPostActions", () => {
  it("lets a guest save a draft and nothing public", () => {
    expect(getPostActions("guest", "draft", false)).toEqual({
      saveDraft: true,
      publish: false,
      save: false,
      updateLive: false,
      unpublish: false,
      archive: false,
      guestLiveBanner: false,
    });
  });

  it("lets an admin save, publish, and archive a draft", () => {
    expect(getPostActions("admin", "draft", false)).toEqual({
      saveDraft: true,
      publish: true,
      save: false,
      updateLive: false,
      unpublish: false,
      archive: true,
      guestLiveBanner: false,
    });
  });

  it("saves a guest edit of a live post as a pending revision", () => {
    expect(getPostActions("guest", "published", true)).toEqual({
      saveDraft: false,
      publish: false,
      save: true,
      updateLive: false,
      unpublish: false,
      archive: false,
      guestLiveBanner: true,
    });
  });

  it("shows the live-unchanged banner even before a guest has a pending revision", () => {
    expect(getPostActions("guest", "published", false).guestLiveBanner).toBe(true);
    expect(getPostActions("guest", "published", false).updateLive).toBe(false);
  });

  it("hides update-live until an admin has a pending revision", () => {
    expect(getPostActions("admin", "published", false)).toEqual({
      saveDraft: false,
      publish: false,
      save: true,
      updateLive: false,
      unpublish: true,
      archive: true,
      guestLiveBanner: false,
    });
  });

  it("lets an admin update, unpublish, and archive a live post with a pending revision", () => {
    expect(getPostActions("admin", "published", true)).toEqual({
      saveDraft: false,
      publish: false,
      save: true,
      updateLive: true,
      unpublish: true,
      archive: true,
      guestLiveBanner: false,
    });
  });

  it("offers no actions on an archived post", () => {
    expect(getPostActions("admin", "archived", true)).toEqual({
      saveDraft: false,
      publish: false,
      save: false,
      updateLive: false,
      unpublish: false,
      archive: false,
      guestLiveBanner: false,
    });
    expect(getPostActions("guest", "archived", false).saveDraft).toBe(false);
  });
});
