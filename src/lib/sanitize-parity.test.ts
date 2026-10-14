import { describe, expect, it } from "vitest";

import { safeHtml } from "@/lib/safe-html";
import { sanitizeHtml } from "@/server/sanitize";

describe("Sanitization parity between client safeHtml (jsdom) and server sanitizeHtml", () => {
  describe("img src '/media/x.png' kept by both", () => {
    const inputs = [
      '<img src="/media/x.png">',
      '<img src="/media/x.png" alt="photo">',
      '<p>Inline <img src="/media/x.png" alt="photo"> image</p>',
    ];

    it.each(inputs)("preserves /media/x.png in %s", (input) => {
      const client = safeHtml(input);
      const server = sanitizeHtml(input);

      expect(client).toContain('src="/media/x.png"');
      expect(server).toContain('src="/media/x.png"');
    });
  });

  describe("img src with http:, data:, javascript: stripped by both", () => {
    const unsafeImgInputs = [
      {
        scheme: "http:",
        input: '<img src="http://example.com/x.png" alt="insecure">',
        forbiddenSnippet: "http://example.com/x.png",
      },
      {
        scheme: "data:",
        input: '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt="data">',
        forbiddenSnippet: "data:image/png",
      },
      {
        scheme: "javascript:",
        input: '<img src="javascript:alert(\'xss\')" alt="js">',
        forbiddenSnippet: "javascript:",
      },
      {
        scheme: "http: (inside text)",
        input: '<p>Before</p><img src="http://example.com/x.png" alt="bad"><p>After</p>',
        forbiddenSnippet: "http://example.com/x.png",
      },
      {
        scheme: "data: (inside text)",
        input: '<p>Before</p><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="bad"><p>After</p>',
        forbiddenSnippet: "data:image/svg+xml",
      },
      {
        scheme: "javascript: (inside text)",
        input: '<p>Before</p><img src="javascript:alert(1)" alt="bad"><p>After</p>',
        forbiddenSnippet: "javascript:",
      },
    ];

    it.each(unsafeImgInputs)("strips img src with $scheme", ({ input, forbiddenSnippet }) => {
      const client = safeHtml(input);
      const server = sanitizeHtml(input);

      expect(client).not.toContain(forbiddenSnippet);
      expect(server).not.toContain(forbiddenSnippet);
      expect(client).not.toContain('src="http:');
      expect(server).not.toContain('src="http:');
      expect(client).not.toContain('src="data:');
      expect(server).not.toContain('src="data:');
      expect(client).not.toContain('src="javascript:');
      expect(server).not.toContain('src="javascript:');
    });
  });

  describe("a href http/https/mailto kept by both and javascript: stripped by both", () => {
    const allowedLinks = [
      {
        scheme: "http",
        input: '<a href="http://example.com/article">HTTP Link</a>',
        expectedHref: 'href="http://example.com/article"',
      },
      {
        scheme: "https",
        input: '<a href="https://example.com/secure">HTTPS Link</a>',
        expectedHref: 'href="https://example.com/secure"',
      },
      {
        scheme: "mailto",
        input: '<a href="mailto:admin@example.com">Contact Us</a>',
        expectedHref: 'href="mailto:admin@example.com"',
      },
    ];

    it.each(allowedLinks)("keeps a href with $scheme", ({ input, expectedHref }) => {
      const client = safeHtml(input);
      const server = sanitizeHtml(input);

      expect(client).toContain(expectedHref);
      expect(server).toContain(expectedHref);
      expect(client).toContain('rel="noopener noreferrer"');
      expect(server).toContain('rel="noopener noreferrer"');
    });

    const disallowedLinks = [
      '<a href="javascript:alert(\'xss\')">Dangerous Link</a>',
      '<a href="javascript:void(0)">Void Link</a>',
      '<p>Read this: <a href=" javascript:alert(1)">Click</a></p>',
    ];

    it.each(disallowedLinks)("strips javascript: from a href in %s", (input) => {
      const client = safeHtml(input);
      const server = sanitizeHtml(input);

      expect(client).not.toContain("javascript:");
      expect(server).not.toContain("javascript:");
      expect(client).not.toContain("href=");
      expect(server).not.toContain("href=");
    });
  });
});
