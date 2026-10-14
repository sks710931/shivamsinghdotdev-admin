import { describe, expect, it } from "vitest";

import { normalizeEditorHtml } from "@/lib/editor-html";

describe("normalizeEditorHtml", () => {
  it("wraps a code sample so pre and code share the language class", () => {
    const html = normalizeEditorHtml('<pre class="language-typescript">const n = 1;</pre>');
    expect(html).toContain('<pre class="language-typescript">');
    expect(html).toContain('<code class="language-typescript">');
    expect(html).toContain("const n = 1;");
  });

  it("drops markup outside the allow-list", () => {
    const html = normalizeEditorHtml(
      '<p><u>nope</u> <a href="javascript:alert(1)">x</a> <a href="https://example.com/a">ok</a></p><script>bad()</script>',
    );
    expect(html).not.toContain("<u>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("bad()");
    expect(html).toContain("nope");
    expect(html).toContain("x");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("disables task checkboxes and drops inline styles", () => {
    const html = normalizeEditorHtml(
      '<ul class="task-list"><li><input type="checkbox"> Ship</li></ul><p><mark style="background-color: red" onclick="alert(1)">x</mark></p>',
    );
    expect(html).toContain("disabled");
    expect(html).not.toContain("style");
    expect(html).not.toContain("onclick");
    expect(html).toContain("<mark>");
  });
});
