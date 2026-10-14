import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  type DraftSnapshot,
} from "./draft-snapshot";

const SAVE_DEBOUNCE_MS = 1000;

export interface UseDraftRecoveryResult {
  pending: DraftSnapshot | null;
  restore: () => DraftSnapshot | null;
  discard: () => void;
  clear: () => void;
}

export function useDraftRecovery(
  postId: string,
  title: string,
  body: string,
): UseDraftRecoveryResult {
  // A stored draft is pending only when it still differs from the title and body
  // this post was opened with. Later keystrokes must not move that baseline.
  const differs = (snapshot: DraftSnapshot | null): DraftSnapshot | null => {
    if (
      snapshot !== null &&
      (snapshot.title !== title || snapshot.body !== body)
    ) {
      return snapshot;
    }
    return null;
  };

  // Opened title and body for this post. Later keystrokes must not move it, or a
  // recovered draft is judged against text the user has already changed.
  const [initial, setInitial] = useState(() => ({
    postId,
    title,
    body,
    pending: differs(loadSnapshot(postId)),
  }));

  if (initial.postId !== postId) {
    setInitial({
      postId,
      title,
      body,
      pending: differs(loadSnapshot(postId)),
    });
  }

  const pending = initial.pending;
  const pendingRef = useRef<DraftSnapshot | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

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
      saveSnapshot({
        postId,
        title,
        body,
        savedAt: new Date().toISOString(),
      });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [postId, title, body, pending, initial.title, initial.body]);

  const restore = useCallback((): DraftSnapshot | null => {
    const snapshot = pendingRef.current;
    setInitial((prev) => ({ ...prev, pending: null }));
    return snapshot;
  }, []);

  const discard = useCallback((): void => {
    clearSnapshot(postId);
    setInitial((prev) => ({ ...prev, pending: null }));
  }, [postId]);

  const clear = useCallback((): void => {
    clearSnapshot(postId);
  }, [postId]);

  return { pending, restore, discard, clear };
}
