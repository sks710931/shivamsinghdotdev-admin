import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSnapshot,
  loadSnapshot,
  pruneSnapshots,
  saveSnapshot,
  type DraftSnapshot,
} from "./draft-snapshot";
import { useDraftRecovery, type PendingDraft } from "./use-draft-recovery";

vi.mock("./draft-snapshot", () => ({
  loadSnapshot: vi.fn(() => null),
  saveSnapshot: vi.fn(() => true),
  clearSnapshot: vi.fn(),
  pruneSnapshots: vi.fn(),
}));

const mockedLoad = vi.mocked(loadSnapshot);
const mockedSave = vi.mocked(saveSnapshot);
const mockedClear = vi.mocked(clearSnapshot);
const mockedPrune = vi.mocked(pruneSnapshots);

const START = new Date("2026-10-14T12:00:00.000Z");
const USER_ID = "user-1";

function snapshot(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    userId: USER_ID,
    postId: "post-1",
    title: "Draft title",
    body: "Draft body",
    savedAt: "2026-10-13T08:00:00.000Z",
    baseVersion: null,
    ...overrides,
  };
}

function offered(draft: DraftSnapshot, stale: boolean): PendingDraft {
  return { ...draft, stale };
}

describe("useDraftRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    mockedLoad.mockReset();
    mockedSave.mockReset();
    mockedClear.mockReset();
    mockedPrune.mockReset();
    mockedLoad.mockReturnValue(null);
    mockedSave.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves pending null when nothing is stored", () => {
    const { result } = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(mockedLoad).toHaveBeenCalledWith(USER_ID, "post-1");
    expect(mockedPrune).toHaveBeenCalledTimes(1);
    expect(mockedPrune).toHaveBeenCalledWith(USER_ID);
    expect(result.current.pending).toBeNull();
  });

  it("leaves pending null when the stored draft matches the current title and body", () => {
    mockedLoad.mockReturnValue(
      snapshot({ title: "Title", body: "Body" }),
    );

    const { result } = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );

    expect(result.current.pending).toBeNull();
  });

  it("sets pending when the stored title or body differs", () => {
    const titleDiffers = snapshot({ title: "Older title", body: "Body" });
    mockedLoad.mockReturnValue(titleDiffers);

    const titleHook = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );
    expect(titleHook.result.current.pending).toEqual(offered(titleDiffers, false));
    titleHook.unmount();

    const bodyDiffers = snapshot({ title: "Title", body: "Older body" });
    mockedLoad.mockReturnValue(bodyDiffers);

    const bodyHook = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );
    expect(bodyHook.result.current.pending).toEqual(offered(bodyDiffers, false));
  });

  it("does not reload or clear pending when the editor text changes", () => {
    const stored = snapshot();
    mockedLoad.mockReturnValue(stored);

    const { result, rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery(USER_ID, "post-1", title, body, null),
      { initialProps: { title: "Title", body: "Body" } },
    );

    rerender({ title: "Title edited", body: "Body edited" });

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toEqual(offered(stored, false));
  });

  it("loads again when the post id changes", () => {
    const first = snapshot({ postId: "post-1" });
    const second = snapshot({
      postId: "post-2",
      title: "Second title",
      body: "Second body",
    });
    mockedLoad.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { result, rerender } = renderHook(
      ({ postId }: { postId: string }) =>
        useDraftRecovery(USER_ID, postId, "Title", "Body", null),
      { initialProps: { postId: "post-1" } },
    );

    expect(result.current.pending).toEqual(offered(first, false));

    rerender({ postId: "post-2" });

    expect(mockedLoad).toHaveBeenNthCalledWith(2, USER_ID, "post-2");
    expect(result.current.pending).toEqual(offered(second, false));
  });

  it("debounces saveSnapshot by 1000ms and keeps the latest title and body", () => {
    const { rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery(USER_ID, "post-1", title, body, null),
      { initialProps: { title: "Title", body: "Body" } },
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockedSave).not.toHaveBeenCalled();

    rerender({ title: "Title 2", body: "Body" });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    rerender({ title: "Title 3", body: "Body 3" });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(mockedSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenLastCalledWith({
      userId: USER_ID,
      postId: "post-1",
      title: "Title 3",
      body: "Body 3",
      baseVersion: null,
      savedAt: "2026-10-14T12:00:02.400Z",
    });
  });

  it("does not save after unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery(USER_ID, "post-1", title, body, null),
      { initialProps: { title: "Title", body: "Body" } },
    );

    rerender({ title: "Title edited", body: "Body" });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("keeps a pending snapshot through 2s of fake timers when the user has not edited", () => {
    const stored = snapshot();
    mockedLoad.mockReturnValue(stored);

    const { result } = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );

    expect(result.current.pending).toEqual(offered(stored, false));

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockedSave).not.toHaveBeenCalled();
    expect(mockedClear).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual(offered(stored, false));
  });

  it("saves edits made after the recovered draft is discarded", () => {
    mockedLoad.mockReturnValue(snapshot());

    const { result, rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery(USER_ID, "post-1", title, body, null),
      { initialProps: { title: "Title", body: "Body" } },
    );

    act(() => {
      result.current.discard();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockedSave).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();

    rerender({ title: "Title edited", body: "Body edited" });

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(mockedSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenLastCalledWith({
      userId: USER_ID,
      postId: "post-1",
      title: "Title edited",
      body: "Body edited",
      baseVersion: null,
      savedAt: "2026-10-14T12:00:02.000Z",
    });
  });

  it("restore returns the pending snapshot and clears pending", () => {
    const stored = snapshot();
    mockedLoad.mockReturnValue(stored);

    const { result } = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );

    let restored: DraftSnapshot | null = null;
    act(() => {
      restored = result.current.restore();
    });

    expect(restored).toEqual(offered(stored, false));
    expect(result.current.pending).toBeNull();
    expect(mockedClear).not.toHaveBeenCalled();

    let second: DraftSnapshot | null = stored;
    act(() => {
      second = result.current.restore();
    });
    expect(second).toBeNull();
  });

  it("discard: removes the stored snapshot and clears pending", () => {
    mockedLoad.mockReturnValue(snapshot());

    const { result } = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );

    act(() => {
      result.current.discard();
    });

    expect(mockedClear).toHaveBeenCalledTimes(1);
    expect(mockedClear).toHaveBeenCalledWith(USER_ID, "post-1");
    expect(result.current.pending).toBeNull();
  });

  it("clear removes the stored snapshot and leaves pending in place", () => {
    const stored = snapshot();
    mockedLoad.mockReturnValue(stored);

    const { result } = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );

    act(() => {
      result.current.clear();
    });

    expect(mockedClear).toHaveBeenCalledTimes(1);
    expect(mockedClear).toHaveBeenCalledWith(USER_ID, "post-1");
    expect(result.current.pending).toEqual(offered(stored, false));
  });

  it("restore offered: offers a fresh pending snapshot when baseVersion matches and the text differs", () => {
    const stored = snapshot({ baseVersion: "rev-1", title: "Older title" });
    mockedLoad.mockReturnValue(stored);

    const { result } = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", "rev-1"),
    );

    expect(result.current.pending).toEqual(offered(stored, false));
    expect(result.current.pending?.stale).toBe(false);
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("restore offered: offers restore when snapshot is newer than server updatedAt", () => {
    const stored = snapshot({
      baseVersion: "rev-1",
      savedAt: "2026-10-14T12:05:00.000Z",
      title: "Newer local draft",
    });
    mockedLoad.mockReturnValue(stored);

    const { result } = renderHook(() =>
      useDraftRecovery(
        USER_ID,
        "post-1",
        "Server Title",
        "Body",
        "rev-1",
        "2026-10-14T12:00:00.000Z",
      ),
    );

    expect(result.current.pending).toEqual(offered(stored, false));
    expect(result.current.pending?.title).toBe("Newer local draft");
  });

  it("stale snapshot ignored: ignores a stale snapshot when baseVersion differs", () => {
    const stored = snapshot({ baseVersion: "rev-1", title: "Older title" });
    mockedLoad.mockReturnValue(stored);

    const mismatch = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", "rev-2"),
    );

    expect(mismatch.result.current.pending).toBeNull();
    expect(mockedClear).not.toHaveBeenCalled();
    expect(mockedPrune).toHaveBeenCalledWith(USER_ID);
    mismatch.unmount();

    const sameText = snapshot({ baseVersion: "rev-1", title: "Title", body: "Body" });
    mockedLoad.mockReturnValue(sameText);

    const unchangedText = renderHook(() =>
      useDraftRecovery(USER_ID, "post-1", "Title", "Body", null),
    );

    expect(unchangedText.result.current.pending).toBeNull();
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it("stale snapshot ignored: ignores snapshot when older than or equal to server updatedAt", () => {
    const olderSnapshot = snapshot({
      baseVersion: "rev-1",
      savedAt: "2026-10-14T11:59:00.000Z",
      title: "Older draft",
    });
    mockedLoad.mockReturnValue(olderSnapshot);

    const { result } = renderHook(() =>
      useDraftRecovery(
        USER_ID,
        "post-1",
        "Server Title",
        "Body",
        "rev-1",
        "2026-10-14T12:00:00.000Z",
      ),
    );

    expect(result.current.pending).toBeNull();

    const equalSnapshot = snapshot({
      baseVersion: "rev-1",
      savedAt: "2026-10-14T12:00:00.000Z",
      title: "Equal timestamp draft",
    });
    mockedLoad.mockReturnValue(equalSnapshot);

    const { result: equalResult } = renderHook(() =>
      useDraftRecovery(
        USER_ID,
        "post-1",
        "Server Title",
        "Body",
        "rev-1",
        "2026-10-14T12:00:00.000Z",
      ),
    );

    expect(equalResult.current.pending).toBeNull();
  });

  it("stale snapshot ignored: clears pending when server baseVersion or updatedAt advances", () => {
    const stored = snapshot({
      baseVersion: "rev-1",
      savedAt: "2026-10-14T12:00:00.000Z",
      title: "Older title",
    });
    mockedLoad.mockReturnValue(stored);

    const { result, rerender } = renderHook(
      ({
        baseVersion,
        serverUpdatedAt,
      }: {
        baseVersion: string | null;
        serverUpdatedAt?: string | null;
      }) =>
        useDraftRecovery(USER_ID, "post-1", "Title", "Body", baseVersion, serverUpdatedAt),
      {
        initialProps: {
          baseVersion: "rev-1",
          serverUpdatedAt: "2026-10-14T11:00:00.000Z",
        },
      },
    );

    expect(result.current.pending).toEqual(offered(stored, false));
    expect(mockedClear).not.toHaveBeenCalled();

    rerender({ baseVersion: "rev-2", serverUpdatedAt: "2026-10-14T11:00:00.000Z" });

    expect(result.current.pending).toBeNull();

    rerender({ baseVersion: "rev-1", serverUpdatedAt: "2026-10-14T13:00:00.000Z" });

    expect(result.current.pending).toBeNull();
  });

  it("saves the server baseVersion with the draft", () => {
    const { rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery(USER_ID, "post-1", title, body, "rev-1"),
      { initialProps: { title: "Title", body: "Body" } },
    );

    rerender({ title: "Title edited", body: "Body edited" });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith({
      userId: USER_ID,
      postId: "post-1",
      title: "Title edited",
      body: "Body edited",
      baseVersion: "rev-1",
      savedAt: "2026-10-14T12:00:01.000Z",
    });
  });

  it("cleared after save: cancels a pending save timer and removes snapshot from storage", () => {
    const { result, rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery(USER_ID, "post-1", title, body, null),
      { initialProps: { title: "Title", body: "Body" } },
    );

    rerender({ title: "Title edited", body: "Body edited" });

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(mockedSave).not.toHaveBeenCalled();

    act(() => {
      result.current.clear();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockedSave).not.toHaveBeenCalled();
    expect(mockedClear).toHaveBeenCalledTimes(1);
    expect(mockedClear).toHaveBeenCalledWith(USER_ID, "post-1");

    rerender({ title: "Title again", body: "Body edited" });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith({
      userId: USER_ID,
      postId: "post-1",
      title: "Title again",
      body: "Body edited",
      baseVersion: null,
      savedAt: "2026-10-14T12:00:02.999Z",
    });
  });
});
