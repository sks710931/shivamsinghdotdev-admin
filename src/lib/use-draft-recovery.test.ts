import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  type DraftSnapshot,
} from "./draft-snapshot";
import { useDraftRecovery } from "./use-draft-recovery";

vi.mock("./draft-snapshot", () => ({
  loadSnapshot: vi.fn(() => null),
  saveSnapshot: vi.fn(() => true),
  clearSnapshot: vi.fn(),
}));

const mockedLoad = vi.mocked(loadSnapshot);
const mockedSave = vi.mocked(saveSnapshot);
const mockedClear = vi.mocked(clearSnapshot);

const START = new Date("2026-10-14T12:00:00.000Z");

function snapshot(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    postId: "post-1",
    title: "Draft title",
    body: "Draft body",
    savedAt: "2026-10-13T08:00:00.000Z",
    ...overrides,
  };
}

describe("useDraftRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    mockedLoad.mockReset();
    mockedSave.mockReset();
    mockedClear.mockReset();
    mockedLoad.mockReturnValue(null);
    mockedSave.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves pending null when nothing is stored", () => {
    const { result } = renderHook(() =>
      useDraftRecovery("post-1", "Title", "Body"),
    );

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(mockedLoad).toHaveBeenCalledWith("post-1");
    expect(result.current.pending).toBeNull();
  });

  it("leaves pending null when the stored draft matches the current title and body", () => {
    mockedLoad.mockReturnValue(
      snapshot({ title: "Title", body: "Body" }),
    );

    const { result } = renderHook(() =>
      useDraftRecovery("post-1", "Title", "Body"),
    );

    expect(result.current.pending).toBeNull();
  });

  it("sets pending when the stored title or body differs", () => {
    const titleDiffers = snapshot({ title: "Older title", body: "Body" });
    mockedLoad.mockReturnValue(titleDiffers);

    const titleHook = renderHook(() =>
      useDraftRecovery("post-1", "Title", "Body"),
    );
    expect(titleHook.result.current.pending).toEqual(titleDiffers);
    titleHook.unmount();

    const bodyDiffers = snapshot({ title: "Title", body: "Older body" });
    mockedLoad.mockReturnValue(bodyDiffers);

    const bodyHook = renderHook(() =>
      useDraftRecovery("post-1", "Title", "Body"),
    );
    expect(bodyHook.result.current.pending).toEqual(bodyDiffers);
  });

  it("does not reload or clear pending when the editor text changes", () => {
    const stored = snapshot();
    mockedLoad.mockReturnValue(stored);

    const { result, rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery("post-1", title, body),
      { initialProps: { title: "Title", body: "Body" } },
    );

    rerender({ title: "Title edited", body: "Body edited" });

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toEqual(stored);
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
        useDraftRecovery(postId, "Title", "Body"),
      { initialProps: { postId: "post-1" } },
    );

    expect(result.current.pending).toEqual(first);

    rerender({ postId: "post-2" });

    expect(mockedLoad).toHaveBeenNthCalledWith(2, "post-2");
    expect(result.current.pending).toEqual(second);
  });

  it("debounces saveSnapshot by 1000ms and keeps the latest title and body", () => {
    const { rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery("post-1", title, body),
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
      postId: "post-1",
      title: "Title 3",
      body: "Body 3",
      savedAt: "2026-10-14T12:00:02.400Z",
    });
  });

  it("does not save after unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery("post-1", title, body),
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
      useDraftRecovery("post-1", "Title", "Body"),
    );

    expect(result.current.pending).toEqual(stored);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockedSave).not.toHaveBeenCalled();
    expect(mockedClear).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual(stored);
  });

  it("saves edits made after the recovered draft is discarded", () => {
    mockedLoad.mockReturnValue(snapshot());

    const { result, rerender } = renderHook(
      ({ title, body }: { title: string; body: string }) =>
        useDraftRecovery("post-1", title, body),
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
      postId: "post-1",
      title: "Title edited",
      body: "Body edited",
      savedAt: "2026-10-14T12:00:02.000Z",
    });
  });

  it("restore returns the pending snapshot and clears pending", () => {
    const stored = snapshot();
    mockedLoad.mockReturnValue(stored);

    const { result } = renderHook(() =>
      useDraftRecovery("post-1", "Title", "Body"),
    );

    let restored: DraftSnapshot | null = null;
    act(() => {
      restored = result.current.restore();
    });

    expect(restored).toBe(stored);
    expect(result.current.pending).toBeNull();
    expect(mockedClear).not.toHaveBeenCalled();

    let second: DraftSnapshot | null = stored;
    act(() => {
      second = result.current.restore();
    });
    expect(second).toBeNull();
  });

  it("discard removes the stored snapshot and clears pending", () => {
    mockedLoad.mockReturnValue(snapshot());

    const { result } = renderHook(() =>
      useDraftRecovery("post-1", "Title", "Body"),
    );

    act(() => {
      result.current.discard();
    });

    expect(mockedClear).toHaveBeenCalledTimes(1);
    expect(mockedClear).toHaveBeenCalledWith("post-1");
    expect(result.current.pending).toBeNull();
  });

  it("clear removes the stored snapshot and leaves pending in place", () => {
    const stored = snapshot();
    mockedLoad.mockReturnValue(stored);

    const { result } = renderHook(() =>
      useDraftRecovery("post-1", "Title", "Body"),
    );

    act(() => {
      result.current.clear();
    });

    expect(mockedClear).toHaveBeenCalledTimes(1);
    expect(mockedClear).toHaveBeenCalledWith("post-1");
    expect(result.current.pending).toEqual(stored);
  });
});
