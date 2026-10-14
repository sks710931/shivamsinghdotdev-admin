import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSnapshot,
  loadSnapshot,
  pruneSnapshots,
  saveSnapshot,
  type DraftSnapshot,
} from "./draft-snapshot";

const SAVE_DEBOUNCE_MS = 1000;

/** A stored draft offered for restore. `stale` is true when its base version differs. */
export interface PendingDraft extends DraftSnapshot {
  stale: boolean;
}

export interface UseDraftRecoveryResult {
  pending: PendingDraft | null;
  restore: () => PendingDraft | null;
  discard: () => void;
  clear: () => void;
}

export function useDraftRecovery(
  userId: string,
  postId: string,
  title: string,
  body: string,
  baseVersion: string | null,
  serverUpdatedAt: string | null = null,
): UseDraftRecoveryResult {
  // A stored draft is pending when its text still differs from the title and body
  // this post was opened with, or when it was saved against another server version.
  // Later keystrokes must not move that baseline. A version mismatch stays pending
  // and is marked stale so restoring and saving will send baseVersion and prompt a
  // 409 conflict screen instead of overwriting newer changes.
  const pendingFrom = (
    snapshot: DraftSnapshot | null,
    openedTitle: string,
    openedBody: string,
    openedBaseVersion: string | null,
    openedServerUpdatedAt: string | null = null,
  ): PendingDraft | null => {
    if (snapshot === null) {
      return null;
    }
    const stale = snapshot.baseVersion !== openedBaseVersion;
    if (openedServerUpdatedAt && !stale) {
      const snapshotTime = Date.parse(snapshot.savedAt);
      const serverTime = Date.parse(openedServerUpdatedAt);
      if (!Number.isNaN(snapshotTime) && !Number.isNaN(serverTime) && snapshotTime <= serverTime) {
        return null;
      }
    }
    if (stale || snapshot.title !== openedTitle || snapshot.body !== openedBody) {
      return { ...snapshot, stale };
    }
    return null;
  };

  // Opened title and body for this post. Later keystrokes must not move it, or a
  // recovered draft is judged against text the user has already changed.
  const [initial, setInitial] = useState(() => ({
    userId,
    postId,
    baseVersion,
    serverUpdatedAt,
    title,
    body,
    pending: pendingFrom(loadSnapshot(userId, postId), title, body, baseVersion, serverUpdatedAt),
  }));

  if (initial.userId !== userId || initial.postId !== postId) {
    setInitial({
      userId,
      postId,
      baseVersion,
      serverUpdatedAt,
      title,
      body,
      pending: pendingFrom(loadSnapshot(userId, postId), title, body, baseVersion, serverUpdatedAt),
    });
  } else if (
    initial.baseVersion !== baseVersion ||
    initial.serverUpdatedAt !== serverUpdatedAt
  ) {
    setInitial({
      userId,
      postId,
      baseVersion,
      serverUpdatedAt,
      title: initial.title,
      body: initial.body,
      pending: pendingFrom(
        loadSnapshot(userId, postId),
        initial.title,
        initial.body,
        baseVersion,
        serverUpdatedAt,
      ),
    });
  }

  const pending = initial.pending;
  const pendingRef = useRef<PendingDraft | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const baseVersionRef = useRef(baseVersion);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    baseVersionRef.current = baseVersion;
  }, [baseVersion]);

  useEffect(() => {
    pruneSnapshots(userId);
  }, [userId]);

  useEffect(() => {
    // Leave a recovered snapshot in place until the user restores or discards it.
    // The opened server copy is not an edit and must not be written back.
    if (pending !== null) {
      return;
    }
    if (title === initial.title && body === initial.body) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveSnapshot({
        userId,
        postId,
        title,
        body,
        baseVersion: baseVersionRef.current,
        savedAt: new Date().toISOString(),
      });
    }, SAVE_DEBOUNCE_MS);
    saveTimerRef.current = timeoutId;

    return () => {
      window.clearTimeout(timeoutId);
      if (saveTimerRef.current === timeoutId) {
        saveTimerRef.current = null;
      }
    };
  }, [userId, postId, title, body, pending, initial.title, initial.body]);

  const restore = useCallback((): PendingDraft | null => {
    const snapshot = pendingRef.current;
    setInitial((prev) => ({ ...prev, pending: null }));
    return snapshot;
  }, []);

  const discard = useCallback((): void => {
    clearSnapshot(userId, postId);
    setInitial((prev) => ({ ...prev, pending: null }));
  }, [userId, postId]);

  const clear = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    clearSnapshot(userId, postId);
  }, [userId, postId]);

  return { pending, restore, discard, clear };
}
