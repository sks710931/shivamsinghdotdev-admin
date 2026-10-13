export interface DraftSnapshot {
  postId: string;
  title: string;
  body: string;
  savedAt: string;
}

export const SNAPSHOT_KEY_PREFIX = "pixel:draft:";
