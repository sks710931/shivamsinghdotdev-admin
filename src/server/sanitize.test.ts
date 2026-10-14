import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "./sanitize";

describe("server sanitizeHtml", () => {
  it("drops script, iframe, and other dangerous tags", () => {
    const dirty = '<script>bad()</script><iframe src="https://evil.com"></iframe><p>Safe</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<iframe");
    expect(clean).toContain("<p>Safe</p>");
  });

  it("strips event handlers and javascript/data URLs", () => {
    const dirty =
      '<p onclick="alert(1)">Text</p>' +
      '<a href="javascript:alert(1)">Bad link</a>' +
      '<a href="https://example.com" onclick="alert(2)">Good link</a>' +
      '<img src="data:image/svg+xml;base64,123" onerror="alert(3)">';

    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("data:");
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  it("permits allowed image sources with https or /media/", () => {
    const dirty =
      '<img src="https://example.com/photo.png" alt="photo">' +
      '<img src="/media/local.png" alt="local">' +
      '<img src="http://insecure.example.com/bad.png" alt="bad">';

    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('src="https://example.com/photo.png"');
    expect(clean).toContain('src="/media/local.png"');
    expect(clean).not.toContain("http://insecure.example.com");
  });

  it("keeps input only as disabled checkbox inside ul.task-list > li", () => {
    const valid = '<ul class="task-list"><li><input type="checkbox" checked> Task</li></ul>';
    const invalid = '<p><input type="text" name="secret"></p>';

    const cleanValid = sanitizeHtml(valid);
    expect(cleanValid).toContain('type="checkbox"');
    expect(cleanValid).toContain('disabled="disabled"');
    expect(cleanValid).toContain('class="task-list"');

    const cleanInvalid = sanitizeHtml(invalid);
    expect(cleanInvalid).not.toContain("<input");
  });
});
