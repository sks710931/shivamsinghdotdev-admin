// @vitest-environment node
import { describe, it, expect } from "vitest";
import payloads from "./xss-payloads.json";

let sanitizeHtml: ((h: string) => string) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sanitizeHtml = (await import("@/server/sanitize")).sanitizeHtml;
} catch {
  sanitizeHtml = undefined;
}

const BANNED_TAGS = /<\s*(script|iframe|svg|form|object|embed|style)\b/i;

describe.skipIf(!sanitizeHtml)("sanitizeHtml security gate (S2)", () => {
  const s = (h: string) => sanitizeHtml!(h);

  it.each(payloads as string[])("neutralises payload %#", (p) => {
    const out = s(p);
    expect(out).not.toMatch(/\son[a-z]+\s*=/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/(href|src)\s*=\s*["']?\s*data:/i);
    expect(out).not.toMatch(BANNED_TAGS);
    expect(out).not.toMatch(/\sstyle\s*=/i);
  });

  it("forces rel on links", () => {
    expect(s('<a href="https://x.dev">x</a>')).toMatch(/rel="noopener noreferrer"/);
  });

  it("keeps only https or /media images", () => {
    expect(s('<img src="https://x.dev/a.png" alt="a">')).toContain("https://x.dev/a.png");
    expect(s('<img src="http://x.dev/a.png">')).not.toContain("http://x.dev");
  });

  it("preserves mark", () => {
    expect(s("<p><mark>x</mark></p>")).toContain("<mark>x</mark>");
  });

  it("keeps language-* on pre and code", () => {
    const out = s('<pre class="language-ts evil"><code class="language-ts">a</code></pre>');
    expect(out).toContain('<pre class="language-ts">');
    expect(out).toContain('<code class="language-ts">');
  });

  it("keeps task-list checkbox disabled, strips others", () => {
    const ok = s('<ul class="task-list"><li><input type="checkbox" checked> a</li></ul>');
    expect(ok).toMatch(/<input[^>]*type="checkbox"/);
    expect(ok).toMatch(/<input[^>]*disabled/);
    expect(s('<p><input type="checkbox"> a</p>')).not.toMatch(/<input/);
  });
});
