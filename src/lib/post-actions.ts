import type { UserRole } from "@/lib/directory";
import type { PostStatus } from "@/lib/posts-client";

export type PostActionVisibility = {
  saveDraft: boolean;
  publish: boolean;
  save: boolean;
  updateLive: boolean;
  unpublish: boolean;
  archive: boolean;
  guestLiveBanner: boolean;
};

const none: PostActionVisibility = {
  saveDraft: false,
  publish: false,
  save: false,
  updateLive: false,
  unpublish: false,
  archive: false,
  guestLiveBanner: false,
};

/**
 * Which writing actions the desk may show.
 * Guests never publish, unpublish, or archive. Publish of a draft and
 * "Update live post" (publish the pending revision) are admin-only.
 * Archived posts have no write actions: the contract has no unarchive route.
 */
export function getPostActions(
  role: UserRole,
  status: PostStatus,
  hasPending: boolean,
): PostActionVisibility {
  const admin = role === "admin";

  if (status === "draft") {
    return {
      ...none,
      saveDraft: true,
      publish: admin,
      archive: admin,
    };
  }

  if (status === "published") {
    return {
      ...none,
      save: true,
      updateLive: admin && hasPending,
      unpublish: admin,
      archive: admin,
      guestLiveBanner: role === "guest",
    };
  }

  return none;
}
