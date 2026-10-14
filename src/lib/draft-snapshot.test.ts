import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearAllSnapshots,
  clearSnapshot,
  loadSnapshot,
  pruneSnapshots,
  saveSnapshot,
  SNAPSHOT_KEY_PREFIX,
  type DraftSnapshot,
} from "@/lib/draft-snapshot";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const sample: DraftSnapshot = {
  userId: "user-1",
  postId: "post-1",
  title: "Draft title",
  body: "<p>Hello</p>",
  savedAt: new Date().toISOString(),
  baseVersion: null,
};

function keyFor(userId: string, postId: string): string {
  return SNAPSHOT_KEY_PREFIX + userId + ":" + postId;
}

function snapshotAt(userId: string, postId: string, savedAt: string): DraftSnapshot {
  return { userId, postId, title: "t", body: "b", savedAt, baseVersion: null };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("draft snapshot storage", () => {
  it("saves and loads a snapshot under the prefixed key", () => {
    expect(saveSnapshot(sample)).toBe(true);
    expect(localStorage.getItem(keyFor(sample.userId, sample.postId))).toBe(JSON.stringify(sample));
    expect(loadSnapshot(sample.userId, sample.postId)).toEqual(sample);
  });

  it("keeps snapshots for different posts separate", () => {
    const other: DraftSnapshot = { ...sample, postId: "post-2", title: "Other" };
    expect(saveSnapshot(sample)).toBe(true);
    expect(saveSnapshot(other)).toBe(true);

    expect(loadSnapshot("user-1", "post-1")).toEqual(sample);
    expect(loadSnapshot("user-1", "post-2")).toEqual(other);

    clearSnapshot("user-1", "post-1");
    expect(loadSnapshot("user-1", "post-1")).toBeNull();
    expect(loadSnapshot("user-1", "post-2")).toEqual(other);
  });

  it("keeps snapshots for the same post separate per user", () => {
    const other: DraftSnapshot = { ...sample, userId: "user-2", title: "Other user" };
    expect(saveSnapshot(sample)).toBe(true);
    expect(saveSnapshot(other)).toBe(true);

    expect(loadSnapshot("user-1", "post-1")).toEqual(sample);
    expect(loadSnapshot("user-2", "post-1")).toEqual(other);
    expect(localStorage.getItem(keyFor("user-1", "post-1"))).toBe(JSON.stringify(sample));
    expect(localStorage.getItem(keyFor("user-2", "post-1"))).toBe(JSON.stringify(other));

    clearSnapshot("user-1", "post-1");
    expect(loadSnapshot("user-1", "post-1")).toBeNull();
    expect(loadSnapshot("user-2", "post-1")).toEqual(other);
  });

  it("ensures drafts are keyed per user+post so user B never sees user A's draft", () => {
    const userADraft: DraftSnapshot = {
      userId: "user-a",
      postId: "post-shared-123",
      title: "Confidential draft by User A",
      body: "<p>Work in progress by user A</p>",
      savedAt: new Date().toISOString(),
      baseVersion: "1",
    };
    expect(saveSnapshot(userADraft)).toBe(true);

    // User B attempting to load draft for the same post gets null
    expect(loadSnapshot("user-b", "post-shared-123")).toBeNull();

    // When User B prunes snapshots, User A's snapshot is removed from shared browser storage
    pruneSnapshots("user-b");
    expect(localStorage.getItem(keyFor("user-a", "post-shared-123"))).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadSnapshot("user-1", "missing")).toBeNull();
  });

  it("clears a stored snapshot", () => {
    saveSnapshot(sample);
    clearSnapshot(sample.userId, sample.postId);
    expect(localStorage.getItem(keyFor(sample.userId, sample.postId))).toBeNull();
    expect(loadSnapshot(sample.userId, sample.postId)).toBeNull();
  });

  it("stores empty title and body", () => {
    const empty: DraftSnapshot = {
      userId: "user-1",
      postId: "post-1",
      title: "",
      body: "",
      savedAt: sample.savedAt,
      baseVersion: null,
    };
    expect(saveSnapshot(empty)).toBe(true);
    expect(loadSnapshot("user-1", "post-1")).toEqual(empty);
  });

  it("drops unknown fields when loading", () => {
    localStorage.setItem(keyFor("user-1", "post-1"), JSON.stringify({ ...sample, extra: true }));
    expect(loadSnapshot("user-1", "post-1")).toEqual(sample);
  });

  it("returns null for malformed or wrongly shaped values", () => {
    const invalid = [
      "not-json",
      "null",
      "[]",
      "42",
      JSON.stringify("text"),
      JSON.stringify({ userId: "user-1", postId: "post-1", title: "t", body: "b" }),
      JSON.stringify({ userId: "user-1", postId: "post-1", title: "t", body: "b", savedAt: 1 }),
      JSON.stringify({ userId: "user-1", postId: 1, title: "t", body: "b", savedAt: "s" }),
      JSON.stringify({ userId: "user-1", postId: "other", title: "t", body: "b", savedAt: "s" }),
      JSON.stringify({ userId: "other", postId: "post-1", title: "t", body: "b", savedAt: "s" }),
      JSON.stringify({ postId: "post-1", title: "t", body: "b", savedAt: "s" }),
      JSON.stringify({ userId: 1, postId: "post-1", title: "t", body: "b", savedAt: "s" }),
      JSON.stringify({ userId: "user-1", postId: "post-1", title: null, body: "b", savedAt: "s" }),
      JSON.stringify({ userId: "user-1", postId: "post-1", title: "t", body: { html: "b" }, savedAt: "s" }),
      JSON.stringify({ userId: "user-1", postId: "post-1", title: "t", body: "b", savedAt: "s", baseVersion: 1 }),
      JSON.stringify({ userId: "user-1", postId: "post-1", title: "t", body: "b", savedAt: "s", baseVersion: false }),
    ];

    for (const raw of invalid) {
      localStorage.setItem(keyFor("user-1", "post-1"), raw);
      expect(loadSnapshot("user-1", "post-1")).toBeNull();
    }
  });

  it("saves a snapshot at the size cap and refuses one character over it", () => {
    const shell: DraftSnapshot = {
      userId: "user-1",
      postId: "post-1",
      title: "",
      body: "",
      savedAt: "",
      baseVersion: null,
    };
    const overhead = JSON.stringify(shell).length;
    const atLimit: DraftSnapshot = { ...shell, body: "a".repeat(1_000_000 - overhead) };
    expect(JSON.stringify(atLimit)).toHaveLength(1_000_000);
    expect(saveSnapshot(atLimit)).toBe(true);
    expect(loadSnapshot("user-1", "post-1")).toEqual(atLimit);

    const over: DraftSnapshot = { ...shell, body: "a".repeat(1_000_000 - overhead + 1) };
    expect(JSON.stringify(over)).toHaveLength(1_000_001);
    expect(saveSnapshot(over)).toBe(false);
    expect(loadSnapshot("user-1", "post-1")).toEqual(atLimit);
  });

  it("does not write when the serialized snapshot is over the cap", () => {
    const shell: DraftSnapshot = {
      userId: "user-1",
      postId: "post-1",
      title: "",
      body: "",
      savedAt: "",
      baseVersion: null,
    };
    const overhead = JSON.stringify(shell).length;
    const over: DraftSnapshot = { ...shell, body: "b".repeat(1_000_000 - overhead + 1) };
    expect(saveSnapshot(over)).toBe(false);
    expect(localStorage.getItem(keyFor("user-1", "post-1"))).toBeNull();
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
    expect(loadSnapshot("user-1", "post-1")).toBeNull();
  });

  it("ignores storage errors when clearing", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(() => clearSnapshot("user-1", "post-1")).not.toThrow();
  });

  it("round-trips a string baseVersion", () => {
    const versioned: DraftSnapshot = { ...sample, baseVersion: "rev-1" };
    expect(saveSnapshot(versioned)).toBe(true);
    expect(loadSnapshot("user-1", "post-1")).toEqual(versioned);
  });

  it("fails closed when localStorage is missing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(saveSnapshot(sample)).toBe(false);
    expect(loadSnapshot("user-1", "post-1")).toBeNull();
    expect(() => clearSnapshot("user-1", "post-1")).not.toThrow();
    expect(() => clearAllSnapshots()).not.toThrow();
    expect(() => pruneSnapshots("user-1")).not.toThrow();
  });

  it("removes every draft key and leaves unrelated keys", () => {
    const other: DraftSnapshot = { ...sample, userId: "user-2", postId: "post-9", baseVersion: "rev-2" };
    expect(saveSnapshot(sample)).toBe(true);
    expect(saveSnapshot(other)).toBe(true);
    localStorage.setItem(SNAPSHOT_KEY_PREFIX + "legacy", "x");
    localStorage.setItem("pixel:draft", "keep");
    localStorage.setItem("unrelated", "keep");

    clearAllSnapshots();

    expect(localStorage.getItem(keyFor(sample.userId, sample.postId))).toBeNull();
    expect(localStorage.getItem(keyFor(other.userId, other.postId))).toBeNull();
    expect(localStorage.getItem(SNAPSHOT_KEY_PREFIX + "legacy")).toBeNull();
    expect(localStorage.getItem("pixel:draft")).toBe("keep");
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(loadSnapshot(sample.userId, sample.postId)).toBeNull();
    expect(loadSnapshot(other.userId, other.postId)).toBeNull();
  });

  it("ignores storage errors when clearing every snapshot", () => {
    localStorage.setItem(keyFor("user-1", "post-1"), "x");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(() => clearAllSnapshots()).not.toThrow();
  });
});

describe("draft snapshot expiry", () => {
  it("returns null and removes a snapshot older than 7 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00.000Z"));
    const now = Date.now();
    const expired: DraftSnapshot = {
      ...sample,
      savedAt: new Date(now - SEVEN_DAYS_MS - 1).toISOString(),
    };
    localStorage.setItem(keyFor(expired.userId, expired.postId), JSON.stringify(expired));

    expect(loadSnapshot(expired.userId, expired.postId)).toBeNull();
    expect(localStorage.getItem(keyFor(expired.userId, expired.postId))).toBeNull();
  });

  it("keeps a snapshot that is exactly 7 days old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00.000Z"));
    const now = Date.now();
    const current: DraftSnapshot = {
      ...sample,
      savedAt: new Date(now - SEVEN_DAYS_MS).toISOString(),
    };
    localStorage.setItem(keyFor(current.userId, current.postId), JSON.stringify(current));

    expect(loadSnapshot(current.userId, current.postId)).toEqual(current);
    expect(localStorage.getItem(keyFor(current.userId, current.postId))).toBe(JSON.stringify(current));
  });

  it("returns null when removing an expired snapshot throws", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00.000Z"));
    const expired: DraftSnapshot = {
      ...sample,
      savedAt: new Date(Date.now() - SEVEN_DAYS_MS - 1).toISOString(),
    };
    localStorage.setItem(keyFor(expired.userId, expired.postId), JSON.stringify(expired));
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("unavailable");
    });

    expect(loadSnapshot(expired.userId, expired.postId)).toBeNull();
  });
});

describe("pruneSnapshots", () => {
  const now = Date.parse("2026-10-14T00:00:00.000Z");

  it("removes other users, expired entries, and unparseable values", () => {
    const fresh = snapshotAt("user-1", "fresh", new Date(now - SEVEN_DAYS_MS).toISOString());
    const expired = snapshotAt("user-1", "expired", new Date(now - SEVEN_DAYS_MS - 1).toISOString());
    const other = snapshotAt("user-2", "fresh", new Date(now).toISOString());
    const undated = snapshotAt("user-1", "undated", "not-a-date");

    localStorage.setItem(keyFor(fresh.userId, fresh.postId), JSON.stringify(fresh));
    localStorage.setItem(keyFor(expired.userId, expired.postId), JSON.stringify(expired));
    localStorage.setItem(keyFor(other.userId, other.postId), JSON.stringify(other));
    localStorage.setItem(keyFor(undated.userId, undated.postId), JSON.stringify(undated));
    localStorage.setItem(keyFor("user-1", "bad-json"), "not-json");
    localStorage.setItem(keyFor("user-1", "bad-shape"), JSON.stringify({ postId: "bad-shape" }));
    localStorage.setItem(SNAPSHOT_KEY_PREFIX + "legacy", JSON.stringify(fresh));
    localStorage.setItem("unrelated", "keep");

    pruneSnapshots("user-1", now);

    expect(localStorage.getItem(keyFor(fresh.userId, fresh.postId))).toBe(JSON.stringify(fresh));
    expect(localStorage.getItem(keyFor(expired.userId, expired.postId))).toBeNull();
    expect(localStorage.getItem(keyFor(other.userId, other.postId))).toBeNull();
    expect(localStorage.getItem(keyFor(undated.userId, undated.postId))).toBeNull();
    expect(localStorage.getItem(keyFor("user-1", "bad-json"))).toBeNull();
    expect(localStorage.getItem(keyFor("user-1", "bad-shape"))).toBeNull();
    expect(localStorage.getItem(SNAPSHOT_KEY_PREFIX + "legacy")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("defaults now to Date.now()", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fresh = snapshotAt("user-1", "fresh", new Date(now).toISOString());
    const expired = snapshotAt("user-1", "expired", new Date(now - SEVEN_DAYS_MS - 1).toISOString());
    localStorage.setItem(keyFor(fresh.userId, fresh.postId), JSON.stringify(fresh));
    localStorage.setItem(keyFor(expired.userId, expired.postId), JSON.stringify(expired));

    pruneSnapshots("user-1");

    expect(localStorage.getItem(keyFor(fresh.userId, fresh.postId))).toBe(JSON.stringify(fresh));
    expect(localStorage.getItem(keyFor(expired.userId, expired.postId))).toBeNull();
  });

  it("ignores storage errors when pruning", () => {
    localStorage.setItem(keyFor("user-2", "post-1"), "x");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(() => pruneSnapshots("user-1", now)).not.toThrow();
  });
});
