import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  SNAPSHOT_KEY_PREFIX,
  type DraftSnapshot,
} from "@/lib/draft-snapshot";

const sample: DraftSnapshot = {
  postId: "post-1",
  title: "Draft title",
  body: "<p>Hello</p>",
  savedAt: "2026-10-14T00:00:00.000Z",
};

function keyFor(postId: string): string {
  return SNAPSHOT_KEY_PREFIX + postId;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("draft snapshot storage", () => {
  it("saves and loads a snapshot under the prefixed key", () => {
    expect(saveSnapshot(sample)).toBe(true);
    expect(localStorage.getItem(keyFor(sample.postId))).toBe(JSON.stringify(sample));
    expect(loadSnapshot(sample.postId)).toEqual(sample);
  });

  it("keeps snapshots for different posts separate", () => {
    const other: DraftSnapshot = { ...sample, postId: "post-2", title: "Other" };
    expect(saveSnapshot(sample)).toBe(true);
    expect(saveSnapshot(other)).toBe(true);

    expect(loadSnapshot("post-1")).toEqual(sample);
    expect(loadSnapshot("post-2")).toEqual(other);

    clearSnapshot("post-1");
    expect(loadSnapshot("post-1")).toBeNull();
    expect(loadSnapshot("post-2")).toEqual(other);
  });

  it("returns null when nothing is stored", () => {
    expect(loadSnapshot("missing")).toBeNull();
  });

  it("clears a stored snapshot", () => {
    saveSnapshot(sample);
    clearSnapshot(sample.postId);
    expect(localStorage.getItem(keyFor(sample.postId))).toBeNull();
    expect(loadSnapshot(sample.postId)).toBeNull();
  });

  it("stores empty title and body", () => {
    const empty: DraftSnapshot = { postId: "post-1", title: "", body: "", savedAt: "2026-10-14T00:00:00.000Z" };
    expect(saveSnapshot(empty)).toBe(true);
    expect(loadSnapshot("post-1")).toEqual(empty);
  });

  it("drops unknown fields when loading", () => {
    localStorage.setItem(keyFor("post-1"), JSON.stringify({ ...sample, extra: true }));
    expect(loadSnapshot("post-1")).toEqual(sample);
  });

  it("returns null for malformed or wrongly shaped values", () => {
    const invalid = [
      "not-json",
      "null",
      "[]",
      "42",
      JSON.stringify("text"),
      JSON.stringify({ postId: "post-1", title: "t", body: "b" }),
      JSON.stringify({ postId: "post-1", title: "t", body: "b", savedAt: 1 }),
      JSON.stringify({ postId: 1, title: "t", body: "b", savedAt: "s" }),
      JSON.stringify({ postId: "other", title: "t", body: "b", savedAt: "s" }),
      JSON.stringify({ postId: "post-1", title: null, body: "b", savedAt: "s" }),
      JSON.stringify({ postId: "post-1", title: "t", body: { html: "b" }, savedAt: "s" }),
    ];

    for (const raw of invalid) {
      localStorage.setItem(keyFor("post-1"), raw);
      expect(loadSnapshot("post-1")).toBeNull();
    }
  });

  it("saves a snapshot at the size cap and refuses one character over it", () => {
    const shell: DraftSnapshot = { postId: "post-1", title: "", body: "", savedAt: "" };
    const overhead = JSON.stringify(shell).length;
    const atLimit: DraftSnapshot = { ...shell, body: "a".repeat(1_000_000 - overhead) };
    expect(JSON.stringify(atLimit)).toHaveLength(1_000_000);
    expect(saveSnapshot(atLimit)).toBe(true);
    expect(loadSnapshot("post-1")).toEqual(atLimit);

    const over: DraftSnapshot = { ...shell, body: "a".repeat(1_000_000 - overhead + 1) };
    expect(JSON.stringify(over)).toHaveLength(1_000_001);
    expect(saveSnapshot(over)).toBe(false);
    expect(loadSnapshot("post-1")).toEqual(atLimit);
  });

  it("does not write when the serialized snapshot is over the cap", () => {
    const shell: DraftSnapshot = { postId: "post-1", title: "", body: "", savedAt: "" };
    const overhead = JSON.stringify(shell).length;
    const over: DraftSnapshot = { ...shell, body: "b".repeat(1_000_000 - overhead + 1) };
    expect(saveSnapshot(over)).toBe(false);
    expect(localStorage.getItem(keyFor("post-1"))).toBeNull();
  });

  it("returns false when saving throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(saveSnapshot(sample)).toBe(false);
  });

  it("returns null when loading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(loadSnapshot("post-1")).toBeNull();
  });

  it("ignores storage errors when clearing", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(() => clearSnapshot("post-1")).not.toThrow();
  });

  it("fails closed when localStorage is missing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(saveSnapshot(sample)).toBe(false);
    expect(loadSnapshot("post-1")).toBeNull();
    expect(() => clearSnapshot("post-1")).not.toThrow();
  });
});
