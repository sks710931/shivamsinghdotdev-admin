export interface DraftSnapshot {
  postId: string;
  title: string;
  body: string;
  savedAt: string;
}

export const SNAPSHOT_KEY_PREFIX = "pixel:draft:";

/** Skip the write above this size so a quota error cannot replace a smaller snapshot. */
const MAX_SERIALIZED_CHARS = 1_000_000;

function snapshotKey(postId: string): string {
  return SNAPSHOT_KEY_PREFIX + postId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDraftSnapshot(value: unknown): value is DraftSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.postId === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.savedAt === "string"
  );
}

function toDraftSnapshot(value: DraftSnapshot): DraftSnapshot {
  return {
    postId: value.postId,
    title: value.title,
    body: value.body,
    savedAt: value.savedAt,
  };
}

export function saveSnapshot(snapshot: DraftSnapshot): boolean {
  try {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SERIALIZED_CHARS) {
      return false;
    }
    localStorage.setItem(snapshotKey(snapshot.postId), serialized);
    return true;
  } catch {
    return false;
  }
}

export function loadSnapshot(postId: string): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(postId));
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isDraftSnapshot(parsed) || parsed.postId !== postId) {
      return null;
    }
    return toDraftSnapshot(parsed);
  } catch {
    return null;
  }
}

export function clearSnapshot(postId: string): void {
  try {
    localStorage.removeItem(snapshotKey(postId));
  } catch {
    // Storage may be unavailable (private mode, disabled, or a security error).
  }
}
