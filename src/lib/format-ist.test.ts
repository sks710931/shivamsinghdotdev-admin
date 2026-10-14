import { describe, expect, it } from "vitest";

import { formatIstDateTime, formatSavedIst } from "@/lib/format-ist";

describe("formatIst", () => {
  it("formats a save time in Asia/Kolkata", () => {
    expect(formatSavedIst("2026-10-13T08:35:00.000Z")).toBe("Saved 14:05 IST");
  });

  it("formats a list timestamp in Asia/Kolkata", () => {
    expect(formatIstDateTime("2026-10-13T08:35:00.000Z")).toBe("13 Oct 2026, 14:05 IST");
  });

  it("returns an empty label for an invalid timestamp", () => {
    expect(formatIstDateTime("not-a-date")).toBe("");
    expect(formatSavedIst("not-a-date")).toBe("Saved");
  });
});
