export interface DraftSnapshot {
  userId: string;
  postId: string;
  title: string;
  body: string;
  savedAt: string;
  /** Server version this draft was taken against. Null for a post that is not saved yet. */
  baseVersion: string | null;
}

export const SNAPSHOT_KEY_PREFIX = "pixel:draft:";

/** Skip the write above this size so a quota error cannot replace a smaller snapshot. */
const MAX_SERIALIZED_CHARS = 1_000_000;

/** Drafts older than this are discarded on load and by pruneSnapshots. */
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function snapshotKey(userId: string, postId: string): string {
  return SNAPSHOT_KEY_PREFIX + userId + ":" + postId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isDraftSnapshot(value: unknown): value is DraftSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.userId === "string" &&
    typeof value.postId === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.savedAt === "string" &&
    isNullableString(value.baseVersion)
  );
}

function toDraftSnapshot(value: DraftSnapshot): DraftSnapshot {
  return {
    userId: value.userId,
    postId: value.postId,
    title: value.title,
    body: value.body,
    savedAt: value.savedAt,
    baseVersion: value.baseVersion,
  };
}

function savedAtMs(savedAt: string): number | null {
  const time = Date.parse(savedAt);
  return Number.isNaN(time) ? null : time;
}

function isOlderThanMaxAge(savedAt: string, now: number): boolean {
  const time = savedAtMs(savedAt);
  return time !== null && now - time > MAX_SNAPSHOT_AGE_MS;
}

function listSnapshotKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null && key.startsWith(SNAPSHOT_KEY_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function belongsToUser(key: string, userId: string): boolean {
  return key.startsWith(SNAPSHOT_KEY_PREFIX + userId + ":");
}

function shouldPrune(key: string, userId: string, now: number): boolean {
  if (!belongsToUser(key, userId)) {
    return true;
  }
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (!isDraftSnapshot(parsed)) {
    return true;
  }
  const time = savedAtMs(parsed.savedAt);
  if (time === null) {
    return true;
  }
  return now - time > MAX_SNAPSHOT_AGE_MS;
}

export function saveSnapshot(snapshot: DraftSnapshot): boolean {
  try {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SERIALIZED_CHARS) {
      return false;
    }
    localStorage.setItem(snapshotKey(snapshot.userId, snapshot.postId), serialized);
    return true;
  } catch {
    return false;
  }
}

export function loadSnapshot(userId: string, postId: string): DraftSnapshot | null {
  try {
    const key = snapshotKey(userId, postId);
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isDraftSnapshot(parsed) || parsed.userId !== userId || parsed.postId !== postId) {
      return null;
    }
    if (isOlderThanMaxAge(parsed.savedAt, Date.now())) {
      localStorage.removeItem(key);
      return null;
    }
    return toDraftSnapshot(parsed);
  } catch {
    return null;
  }
}

export function clearSnapshot(userId: string, postId: string): void {
  try {
    localStorage.removeItem(snapshotKey(userId, postId));
  } catch {
    // Storage may be unavailable (private mode, disabled, or a security error).
  }
}

/** Remove every draft snapshot so a signed-out browser cannot restore them. */
export function clearAllSnapshots(): void {
  try {
    const keys = listSnapshotKeys();
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable (private mode, disabled, or a security error).
  }
}

/** Drop other users' drafts, expired drafts, and values that cannot be read. */
export function pruneSnapshots(userId: string, now: number = Date.now()): void {
  try {
    const keys = listSnapshotKeys();
    for (const key of keys) {
      if (shouldPrune(key, userId, now)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage may be unavailable (private mode, disabled, or a security error).
  }
}
